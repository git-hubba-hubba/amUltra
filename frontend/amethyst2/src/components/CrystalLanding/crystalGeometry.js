const vertices = [[0,0],[50,0],[100,0],[0,35],[32,28],[67,24],[100,35],[0,70],[25,65],[53,51],[78,65],[100,70],[0,100],[35,100],[68,100],[100,100]]
const triangles = [[0,1,4],[0,4,3],[1,5,4],[1,2,5],[2,6,5],[3,4,8],[3,8,7],[4,5,9],[4,9,8],[5,6,10],[5,10,9],[6,11,10],[7,8,12],[8,13,12],[8,9,13],[9,14,13],[9,10,14],[10,15,14],[10,11,15]]
export const pieces = triangles.map((triangle, index) => {
  const points = triangle.map(vertex => vertices[vertex])
  return { points: points.map(point => point.join(',')).join(' '), x: points.reduce((sum, p) => sum + p[0], 0) / 3, y: points.reduce((sum, p) => sum + p[1], 0) / 3, rotation: (index % 2 ? 1 : -1) * (25 + index * 7) }
})
