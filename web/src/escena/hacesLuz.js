// Haces de luz visibles en el aire: un cono aditivo por foco, del foco hacia el cuadro.
// Se desvanecen a lo largo del cono, en los bordes de la silueta y cerca de la cámara,
// para que no corten la vista al pasar por debajo.
import * as THREE from 'three';

// Capa propia: la cámara del reflejo del suelo no la ve.
export const CAPA_AIRE = 1;

const vertice = /* glsl */ `
uniform float uLargo;
varying float vAlong;
varying vec3 vNormalVista;
varying vec3 vPosVista;
void main() {
  vAlong = clamp( -position.y / uLargo, 0.0, 1.0 );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vPosVista = mv.xyz;
  vNormalVista = normalize( normalMatrix * normal );
  gl_Position = projectionMatrix * mv;
}`;

const fragmento = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensidad;
varying float vAlong;
varying vec3 vNormalVista;
varying vec3 vPosVista;
void main() {
  vec3 v = normalize( -vPosVista );
  float borde = pow( abs( dot( normalize( vNormalVista ), v ) ), 2.2 );
  float largo = smoothstep( 0.0, 0.12, vAlong ) * ( 1.0 - smoothstep( 0.55, 1.0, vAlong ) );
  float cerca = smoothstep( 0.4, 2.2, length( vPosVista ) );
  float a = uIntensidad * borde * largo * cerca * ( 1.15 - vAlong * 0.5 );
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

export function crearHaces(focos, { intensidad = 0.022 } = {}) {
  const grupo = new THREE.Group();
  grupo.name = 'haces';
  const arriba = new THREE.Vector3(0, -1, 0);
  for (const f of focos) {
    const pos = new THREE.Vector3().fromArray(f.posicion);
    const objetivo = new THREE.Vector3().fromArray(f.objetivo);
    const dir = objetivo.clone().sub(pos);
    const largo = dir.length() * 0.96;
    dir.normalize();
    const radio = Math.tan(THREE.MathUtils.degToRad(f.angulo / 2)) * largo * 0.6;
    const geo = new THREE.ConeGeometry(radio, largo, 40, 12, true);
    geo.translate(0, -largo / 2, 0); // vértice en el origen y base en y = -largo
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertice,
      fragmentShader: fragmento,
      uniforms: {
        uLargo: { value: largo },
        uColor: { value: new THREE.Color(1.0, 0.82, 0.62) },
        uIntensidad: { value: intensidad * (f.intensidad ?? 1) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cono = new THREE.Mesh(geo, mat);
    cono.position.copy(pos);
    cono.quaternion.setFromUnitVectors(arriba, dir);
    cono.renderOrder = 10;
    cono.frustumCulled = false;
    cono.layers.set(CAPA_AIRE);
    grupo.add(cono);
  }
  return grupo;
}
