// Each side keeps its own silhouette. Where one side extends beyond the other,
// close only the exposed area on the centre plane.
function buildExteriorShell(THREE, frame, rightDepth, leftDepth) {
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
  function vertex(pixel, z) {
    const x = pixel % width, y = Math.floor(pixel / width);
    const index = position.length / 3;
    position.push((x - muzzlePx) * cm + muzzleX, (axisPx - y) * cm, z);
    uv.push((x + .5) / width, 1 - (y + .5) / height);
    const radius = Math.max(.3, rowRadius[y] * zMax / 255);
    rearUv.push(Math.max(0, Math.min(1, .5 + z / (2 * radius))), 1 - Math.max(0, Math.min(1, (y - 100) / 155)));
    rearBlend.push(y >= 99 && x < 128 ? Math.max(0, Math.min(1, 1 - (x - rowStart[y] - 6) / 24)) : 0);
    return index;
  }
  for (const [sign, depth] of [[1, rightDepth], [-1, leftDepth]]) {
    const index = new Int32Array(width * height).fill(-1);
    for (let y = 1; y < height - 1; ++y) {
      for (let x = 1; x < width - 1; ++x) {
        const p = y * width + x;
        if (!depth[p]) continue;
        // End the one-pixel silhouette rim at the join between sides.
        const rim = !depth[p - 1] || !depth[p + 1] || !depth[p - width] || !depth[p + width]
          || !depth[p - width - 1] || !depth[p + width + 1] || !depth[p - width + 1] || !depth[p + width - 1];
        index[p] = vertex(p, rim ? 0 : sign * (depth[p] - 1) / 254 * zMax);
      }
    }
    sideIndices.push(index);
  }
  function mid(p) {
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
  const stripUv = [], endUv = [], mix = [];
  const saturate = value => Math.max(0, Math.min(1, value));
  const weight = normal => {
    const t = saturate((normal - .32) / .53);
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < normals.count; ++i) {
    const u = uv[2*i], v = uv[2*i+1], z = position[3*i+2];
    const x = Math.floor(u * width), y = Math.floor((1-v) * height);
    stripUv.push(u, saturate(.5 - z / (2*zMax)));
    const nx = normals.getX(i), ny = normals.getY(i);
    const roof = weight(ny) * saturate(1 - (y - upper[x] - 5) / 18);
    const base = weight(-ny) * saturate(1 - (lower[x] - y - 4) / 14);
    const rear = rearBlend[i] * weight(-nx);
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
  geometry.setAttribute("stripUv", new THREE.Float32BufferAttribute(stripUv, 2));
  geometry.setAttribute("endUv", new THREE.Float32BufferAttribute(endUv, 2));
  geometry.setAttribute("finishMix", new THREE.Float32BufferAttribute(mix, 4));
  geometry.computeBoundingSphere();
  return geometry;
}
