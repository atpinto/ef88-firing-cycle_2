// Exterior-only surface reconstruction. The source masks keep the photographed
// silhouette; these fields add rounded cross-sections and restrained surface relief.
function refineExteriorDepth(frame, depth, rgba) {
  const {W: width, H: height, cm, zMax} = frame;
  const result = new Float32Array(depth.length);
  const distance = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; ++i) distance[i] = depth[i] ? 1000 : 0;
  // Chamfer distance softens the thin, pinched seam around the old flat profiles.
  for (let y = 1; y < height; ++y) for (let x = 1; x < width; ++x) {
    const p = y*width+x;
    distance[p] = Math.min(distance[p], distance[p-1]+1, distance[p-width]+1);
  }
  for (let y = height-2; y >= 0; --y) for (let x = width-2; x >= 0; --x) {
    const p = y*width+x;
    distance[p] = Math.min(distance[p], distance[p+1]+1, distance[p+width]+1);
  }
  const luma = (x,y) => {
    const p = 4*(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)));
    return (rgba[p]*.2126+rgba[p+1]*.7152+rgba[p+2]*.0722)/255;
  };
  const round = t => Math.sqrt(Math.max(0,1-t*t));
  for (let y = 1; y < height-1; ++y) for (let x = 1; x < width-1; ++x) {
    const p = y*width+x;
    if (!depth[p]) continue;
    let z = (depth[p]-1)/254*zMax;
    const edge = Math.min(1, Math.max(0,(distance[p]-1)/6));
    z *= Math.sqrt(edge*(2-edge));
    // The optic is a tube, rather than a rectangular slab with a pointed end.
    if (x >= 221 && x <= 382 && y < 70) {
      if (y >= 25 && y <= 64) {
        z = 2.02*round((y-44.5)/19.5);
        // Preserve the side adjustment dial's protrusion.
        if (x > 244 && x < 285 && y > 30 && y < 61) z += Math.max(0,(depth[p]-90)/254*zMax)*.35;
      } else if (y < 25) {
        // Small sight tabs sit near the tube's centre plane; they must not
        // extrude across its full diameter like a folded sheet.
        z = Math.min(z,.38);
      }
    }
    // Visible barrel and foregrip cross-sections follow their photographed edges.
    if (x > 546 && y > 106 && y < 134) {
      let top=y, bottom=y;
      while (top > 100 && depth[(top-1)*width+x]) --top;
      while (bottom < 140 && depth[(bottom+1)*width+x]) ++bottom;
      z = (bottom-top)*cm/2*round((y-(top+bottom)/2)/Math.max(1,(bottom-top)/2));
    }
    if (x > 498 && x < 534 && y > 162 && y < 242) {
      let left=x, right=x;
      while (left > 490 && depth[y*width+left-1]) --left;
      while (right < 538 && depth[y*width+right+1]) ++right;
      z = (right-left)*cm/2*round((x-(left+right)/2)/Math.max(1,(right-left)/2));
    }
    // Restrict photograph-derived relief to molded/knurled details. Broad paint
    // mottling on the stock must stay color, rather than becoming bumpy geometry.
    const magazine = y > 180 && x > 165 && x < 252;
    const gripRings = y > 205 && y < 239 && x > 500 && x < 532;
    const rail = y > 80 && y < 94 && x > 215 && x < 521;
    if (distance[p] > 2 && (magazine || gripRings || rail)) {
      const local = (luma(x-4,y)+luma(x+4,y)+luma(x,y-4)+luma(x,y+4))/4;
      z += Math.max(-.10, Math.min(.16,(luma(x,y)-local)*(magazine ? 1.5 : .8)));
    }
    result[p] = Math.max(0,z);
  }
  return result;
}

// Each side keeps its own silhouette. Where one side extends beyond the other,
// close only the exposed area on the centre plane.
function buildExteriorShell(THREE, frame, rightDepth, leftDepth, rightSurface, leftSurface) {
  const {W: width, H: height, cm, zMax, muzzlePx, axisPx, muzzleX} = frame;
  const position = [], uv = [], rearUv = [], rearBlend = [], indices = [[], [], []];
  const centre = new Int32Array(width * height).fill(-1);
  const sideIndices = [];
  const rowStart = new Int32Array(height).fill(width);
  const rowRadius = new Float32Array(height);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < 130; ++x) {
      const pixel = y * width + x;
      if (rightDepth[pixel] || leftDepth[pixel]) {
        rowStart[y] = x;
        for (let j = x; j < x + 35; ++j) {
          rowRadius[y] = Math.max(rowRadius[y], rightDepth[y * width + j], leftDepth[y * width + j]);
        }
        break;
      }
    }
  }
  const upper = new Int32Array(width).fill(height);
  const lower = new Int32Array(width).fill(-1);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const p = y * width + x;
      if (rightDepth[p] || leftDepth[p]) {
        upper[x] = Math.min(upper[x], y);
        lower[x] = y;
      }
    }
  }
  // Register matching upper outlines before building the shared ridge. The
  // independent side photographs differ by a few pixels along the same edge.
  const tops = [rightDepth, leftDepth].map(depth => {
    const top = new Int32Array(width).fill(height);
    for (let x = 0; x < width; ++x) {
      for (let y = 1; y < height - 1; ++y) {
        if (depth[y * width + x]) { top[x] = y; break; }
      }
    }
    return top;
  });
  const crown = new Int32Array(width).fill(-1);
  const registered = x => tops[0][x] < height && tops[1][x] < height &&
    Math.abs(tops[0][x] - tops[1][x]) <= 6;
  // Rounded heel and nearly parallel stock sides traced in the overhead view.
  function stockRadius(x) {
    const t = Math.max(0, Math.min(1, (x - 16) / 22));
    return 25.2 * cm * Math.sqrt(t * (2 - t));
  }
  function vertex(pixel, z, elevationRow = Math.floor(pixel / width)) {
    const x = pixel % width, y = Math.floor(pixel / width);
    const index = position.length / 3;
    position.push((x - muzzlePx) * cm + muzzleX, (axisPx - elevationRow) * cm, z);
    uv.push((x + .5) / width, 1 - (y + .5) / height);
    const radius = Math.max(.3, rowRadius[y] * zMax / 255);
    rearUv.push(Math.max(0, Math.min(1, .5 + z / (2 * radius))), 1 - Math.max(0, Math.min(1, (y - 100) / 155)));
    rearBlend.push(y >= 99 && x < 128 ? Math.max(0, Math.min(1, 1 - (x - rowStart[y] - 6) / 24)) : 0);
    return index;
  }
  for (const [sign, depth, surface] of [[1, rightDepth, rightSurface], [-1, leftDepth, leftSurface]]) {
    const top = tops[sign > 0 ? 0 : 1];
    const index = new Int32Array(width * height).fill(-1);
    for (let y = 1; y < height - 1; ++y) {
      for (let x = 1; x < width - 1; ++x) {
        const p = y * width + x;
        if (!depth[p]) continue;
        // End the one-pixel silhouette rim at the join between sides.
        const rim = !depth[p - 1] || !depth[p + 1] || !depth[p - width] || !depth[p + width]
          || !depth[p - width - 1] || !depth[p + width + 1] || !depth[p - width + 1] || !depth[p + width - 1];
        const row = y - top[x];
        const join = registered(x);
        const ridgeRow = (tops[0][x] + tops[1][x]) / 2;
        if (join && row === 0) {
          if (crown[x] < 0) crown[x] = vertex(p, 0, ridgeRow);
          index[p] = crown[x];
          continue;
        }
        let radius = rim ? 0 : (surface ? surface[p] : (depth[p] - 1) / 254 * zMax);
        if (x < 218 && row >= 0 && !rim) {
          // A shallow elliptical crown meets broad sidewalls. Fade into the
          // original side profile below the shoulder and under the optic.
          const t = Math.min(1, row / 8);
          const crownRadius = stockRadius(x) * Math.sqrt(t * (2 - t));
          const blend = Math.min(1, (218-x)/12, Math.max(0,(35-row)/16));
          radius += (crownRadius-radius)*blend;
        }
        const elevation = join ? y + (ridgeRow-top[x])*Math.max(0,1-row/9) : y;
        index[p] = vertex(p, sign * radius, elevation);
      }
    }
    sideIndices.push(index);
  }
  function mid(p) {
    const x = p % width;
    // A centre-plane closure from the taller side must end at the joined
    // ridge as well, or its edge will protrude through the crown at a tilt.
    if (crown[x] >= 0 && Math.floor(p / width) <= Math.max(tops[0][x], tops[1][x])) {
      return crown[x];
    }
    if (centre[p] < 0) centre[p] = vertex(p, 0);
    return centre[p];
  }
  const [right, left] = sideIndices;
  function triangle(a, b, c) {
    const hasRight = right[a] >= 0 && right[b] >= 0 && right[c] >= 0;
    const hasLeft = left[a] >= 0 && left[b] >= 0 && left[c] >= 0;
    if (hasRight) indices[0].push(right[a], right[b], right[c]);
    if (hasLeft) indices[1].push(left[c], left[b], left[a]);
    if (hasRight && !hasLeft) indices[2].push(mid(c), mid(b), mid(a));
    if (hasLeft && !hasRight) indices[2].push(mid(a), mid(b), mid(c));
  }
  for (let y = 0; y < height - 1; ++y) {
    for (let x = 0; x < width - 1; ++x) {
      const a = y * width + x, b = a + 1, c = a + width, d = c + 1;
      const diagonalAD = (right[a] >= 0 && right[d] >= 0 && (right[b] < 0 || right[c] < 0))
                      || (left[a] >= 0 && left[d] >= 0 && (left[b] < 0 || left[c] < 0));
      if (diagonalAD) { triangle(a, c, d); triangle(a, d, b); }
      else { triangle(a, c, b); triangle(b, c, d); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("rearUv", new THREE.Float32BufferAttribute(rearUv, 2));
  let start = 0;
  for (const [materialIndex, group] of indices.entries()) {
    geometry.addGroup(start, group.length, materialIndex);
    start += group.length;
  }
  geometry.setIndex(new THREE.Uint32BufferAttribute(indices.flat(), 1));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  const overheadUv = [], stripUv = [], endUv = [], mix = [];
  const saturate = value => Math.max(0, Math.min(1, value));
  const weight = normal => {
    const t = saturate((normal - .32) / .53);
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < normals.count; ++i) {
    const u = uv[2*i], v = uv[2*i+1], z = position[3*i+2];
    const x = Math.floor(u * width), y = Math.floor((1-v) * height);
    // Use the local width of each part, so narrow tubes do not sample only
    // a tiny band of the overhead/underside reference.
    const edgeY = y < (upper[x]+lower[x])/2 ? upper[x] : lower[x];
    const field = z >= 0 ? rightSurface : leftSurface;
    let localRadius = 0;
    if (field) for (let j = Math.max(0,edgeY-24); j <= Math.min(height-1,edgeY+24); ++j) {
      localRadius = Math.max(localRadius,field[j*width+x]);
    }
    stripUv.push(u, saturate(.5 - z / (2*Math.max(.3,localRadius || zMax))));
    // The straightened top photo shares the side maps’ longitudinal scale.
    // Sample across the photographed width in a single coordinate system.
    const centreRow = 60 + 4 * saturate((550-x)/300);
    overheadUv.push(u, saturate(1 - (centreRow + z/cm)/120));
    const nx = normals.getX(i), ny = normals.getY(i);
    const tube = x >= 219 && x <= 384 && y < 70;
    const stock = x < 218;
    const roofBand = tube ? saturate((46-y)/8) : saturate(1 - (y - upper[x] - 5) / 18);
    const roof = (stock && y <= upper[x]+5 ? 1 : weight(ny)) * roofBand;
    const base = (tube ? 0 : 1) * weight(-ny) * saturate(1 - (lower[x] - y - 4) / 14);
    const rear = rearBlend[i] * weight(-nx) * (1-roof);
    // Map the visible end faces into the straight-on exterior reference.
    let endX = 0, endY = 0, front = 0;
    if (x > 772) {
      endX = 169 - 19*z; endY = 201 + (y-120)*1.85;
      front = saturate((x-772)/7);
    } else if (x > 368 && x < 392 && y < 66) {
      endX = 177 - 16*z; endY = 83 + (y-42)*1.28;
      front = saturate((x-368)/12);
    } else if (x > 495 && x < 523 && z > 2.2 && y > 113 && y < 156) {
      endX = 102 - (z-3.5)*17; endY = 212 + (y-134)*1.65;
      front = saturate((x-495)/9);
    }
    endUv.push(saturate(endX/365), 1-saturate(endY/450));
    mix.push(roof, base, rear, front * weight(nx));
  }
  geometry.setAttribute("overheadUv", new THREE.Float32BufferAttribute(overheadUv, 2));
  geometry.setAttribute("stripUv", new THREE.Float32BufferAttribute(stripUv, 2));
  geometry.setAttribute("endUv", new THREE.Float32BufferAttribute(endUv, 2));
  geometry.setAttribute("finishMix", new THREE.Float32BufferAttribute(mix, 4));
  geometry.computeBoundingSphere();
  return geometry;
}
