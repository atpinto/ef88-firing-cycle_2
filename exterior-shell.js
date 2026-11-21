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
  const color = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; ++i) {
    const t = Math.max(0, Math.min(1, (Math.abs(normals.getY(i)) - .45) / .4));
    color.fill(1 - .6 * t * t * (3 - 2 * t), i * 3, i * 3 + 3);
    rearBlend[i] *= Math.max(0, Math.min(1, (-normals.getX(i) - .32) / .48));
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute("rearBlend", new THREE.Float32BufferAttribute(rearBlend, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
