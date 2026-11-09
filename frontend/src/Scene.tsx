// Escenarios 3D/2D de VISION AI: entornos detallados por sector, HANS con control automático o manual,
// colisiones con el mobiliario, vista 3D orbital o vista 2D de planta y detección DEMO por proximidad.
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';

export const SCENE_FONT = '/fonts/LiberationSans-Bold.ttf';
export type Sector = 'seguridad' | 'manufactura' | 'retail' | 'transporte' | 'agricultura' | 'salud';
export type Item = { id: string; label: string; kind: string; pos: [number, number, number]; confidence: number; severity?: 'info' | 'warning' };
export type ControlMode = 'auto' | 'manual';
export type ViewMode = '3d' | '2d';
export type Keys = Record<string, boolean>;
type V3 = [number, number, number];

export const sectors:{id:Sector;label:string;subtitle:string}[]=[
{id:'seguridad',label:'Seguridad y prevención',subtitle:'Persona, dos cascos, cono y automóvil · Proximidad a zonas y objetos'},
{id:'manufactura',label:'Manufactura',subtitle:'Inspección visual de piezas y posibles defectos'},
{id:'retail',label:'Retail y almacenes',subtitle:'Cajas, estantes, pallet y flujo de inventario'},
{id:'transporte',label:'Transporte y logística',subtitle:'Vehículos, conos y zonas de circulación'},
{id:'agricultura',label:'Agricultura',subtitle:'Frutos, cultivos y hojas afectadas'},
{id:'salud',label:'Salud e investigación',subtitle:'Muestras e instrumental · revisión asistida, no diagnóstico'}];
export const catalog:Record<Sector,Item[]>={
seguridad:[{id:'helmet1',label:'Casco 1 · ZONA RESTRINGIDA',kind:'helmet',pos:[-3,0,-1.1],confidence:.96,severity:'warning'},{id:'helmet2',label:'Casco 2 · ZONA DE ACCESO',kind:'helmet',pos:[1.1,0,-1.1],confidence:.94},{id:'cone',label:'Cono de seguridad',kind:'cone',pos:[3.4,0,1.1],confidence:.98,severity:'warning'},{id:'car',label:'Automóvil',kind:'car',pos:[-1.2,0,2.4],confidence:.93,severity:'warning'}],
manufactura:[{id:'product1',label:'Pieza A',kind:'product',pos:[-3,0,-1],confidence:.95},{id:'product2',label:'Pieza B',kind:'product',pos:[.3,0,-1],confidence:.92},{id:'defect',label:'Posible defecto',kind:'defect',pos:[2.6,0,1],confidence:.88,severity:'warning'},{id:'machine',label:'Máquina',kind:'machine',pos:[-1.5,0,2.4],confidence:.97}],
retail:[{id:'box1',label:'Caja 1',kind:'box',pos:[-3,0,-1.1],confidence:.96},{id:'box2',label:'Caja 2',kind:'box',pos:[.7,0,-1.1],confidence:.94},{id:'pallet',label:'Pallet',kind:'pallet',pos:[3,0,1.2],confidence:.92},{id:'shelf',label:'Estante',kind:'shelf',pos:[-1.4,0,2.4],confidence:.97}],
transporte:[{id:'truck',label:'Camión',kind:'truck',pos:[-3,0,-1],confidence:.95},{id:'vehicle',label:'Automóvil',kind:'car',pos:[1,0,-1],confidence:.94},{id:'cone1',label:'Cono vial 1',kind:'cone',pos:[3,0,1.2],confidence:.96,severity:'warning'},{id:'cone2',label:'Cono vial 2',kind:'cone',pos:[-1.2,0,2.4],confidence:.93,severity:'warning'}],
agricultura:[{id:'fruit1',label:'Fruto 1',kind:'fruit',pos:[-3,0,-1],confidence:.95},{id:'fruit2',label:'Fruto 2',kind:'fruit',pos:[1,0,-1],confidence:.93},{id:'leaf',label:'Hoja afectada',kind:'leaf',pos:[3,0,1.1],confidence:.89,severity:'warning'},{id:'plant',label:'Cultivo',kind:'plant',pos:[-1.2,0,2.4],confidence:.96}],
salud:[{id:'sample1',label:'Muestra A',kind:'sample',pos:[-3,0,-1],confidence:.95},{id:'sample2',label:'Muestra B',kind:'sample',pos:[1,0,-1],confidence:.93},{id:'microscope',label:'Microscopio',kind:'microscope',pos:[3,0,1.1],confidence:.96},{id:'tray',label:'Bandeja',kind:'tray',pos:[-1.2,0,2.4],confidence:.91}]};
const colors:Record<string,string>={helmet:'#f8c443',cone:'#fa812e',car:'#369fe9',truck:'#6394d8',box:'#d7a36a',pallet:'#9e744b',shelf:'#8db5cf',product:'#64b7b0',defect:'#f16b70',machine:'#8d9fb3',fruit:'#e9654d',leaf:'#d3b151',plant:'#54ad6b',sample:'#bb91e5',microscope:'#8aa6d0',tray:'#b4c3d2'};

/* ------------------------------------------------------------------ primitivas */
const B = ({ p, s, c, r, e, o }: { p: V3; s: V3; c: string; r?: V3; e?: string; o?: number }) =>
  <mesh position={p} rotation={r} castShadow receiveShadow><boxGeometry args={s} /><meshStandardMaterial color={c} emissive={e || '#000'} emissiveIntensity={e ? .8 : 0} transparent={o !== undefined} opacity={o ?? 1} /></mesh>;
const C = ({ p, rt, rb, h, c, r, seg = 18, e }: { p: V3; rt: number; rb?: number; h: number; c: string; r?: V3; seg?: number; e?: string }) =>
  <mesh position={p} rotation={r} castShadow receiveShadow><cylinderGeometry args={[rt, rb ?? rt, h, seg]} /><meshStandardMaterial color={c} emissive={e || '#000'} emissiveIntensity={e ? 1 : 0} /></mesh>;
const S = ({ p, rad, c, sc, e }: { p: V3; rad: number; c: string; sc?: V3; e?: string }) =>
  <mesh position={p} scale={sc} castShadow><sphereGeometry args={[rad, 16, 12]} /><meshStandardMaterial color={c} emissive={e || '#000'} emissiveIntensity={e ? 1 : 0} /></mesh>;
const Flat = ({ p, w, d, c, o = 1 }: { p: [number, number]; w: number; d: number; c: string; o?: number }) =>
  <mesh position={[p[0], .012, p[1]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[w, d]} /><meshStandardMaterial color={c} transparent={o < 1} opacity={o} /></mesh>;
const Wheel = ({ p, r = .32, w = .25 }: { p: V3; r?: number; w?: number }) => <C p={p} rt={r} h={w} c="#1d252c" r={[Math.PI / 2, 0, 0]} />;

/* ------------------------------------------------------------------ mobiliario */
type D = { k: string; p: [number, number]; r?: number; c?: string; s?: V3; h?: number; n?: number };
const boxTones = ['#d9893b', '#c97a2e', '#e3a857', '#b8742f'];

const FOOT: Record<string, [number, number]> = {
  rack: [3.2, .9], tree: [.9, .9], truck: [4.4, 1.9], forklift: [1.1, 2], tank: [1.8, 1.8], container: [3.4, 1.3], machine: [1.6, 1.2],
  conveyor: [4, .9], robot: [1.1, 1.1], bench: [2.6, 1], cabinet: [1.2, .7], hood: [1.6, .9], crop: [5, .9], barn: [3.4, 2.8], lamp: [.3, .3],
  tlight: [.3, .3], bin: [.6, .6], stack: [1.2, 1.2], booth: [1.5, 1.5], counter: [2.2, .8], tractor: [1.6, 2.6], plant: [.6, .6], desk: [1.8, .9],
};
type Box = { x0: number; x1: number; z0: number; z1: number };
function footprint(d: D): Box | null {
  let f: [number, number] | undefined = FOOT[d.k];
  if (d.k === 'wall' || d.k === 'fence' || d.k === 'barrier') f = [d.s![0], d.s![2] + .1];
  if (!f) return null;
  const rot = Math.abs(Math.sin(d.r || 0)) > .7;
  const [w, z] = rot ? [f[1], f[0]] : f;
  return { x0: d.p[0] - w / 2, x1: d.p[0] + w / 2, z0: d.p[1] - z / 2, z1: d.p[1] + z / 2 };
}

function Rack({ c = '#d9893b', seed = 0 }: { c?: string; seed?: number }) {
  return <group>
    {[-1.55, 1.55].flatMap(x => [-.4, .4].map(z => <B key={x + '' + z} p={[x, 1.1, z]} s={[.08, 2.2, .08]} c="#2f6fb0" />))}
    {[.12, .92, 1.72].map(y => <B key={y} p={[0, y, 0]} s={[3.2, .07, .9]} c="#e0a83a" />)}
    {[.12, .92, 1.72].flatMap((y, li) => [-1.05, 0, 1.05].map((x, i) => (seed + li + i) % 5 === 4 ? null :
      <B key={y + '-' + x} p={[x, y + .32, 0]} s={[.85, .55, .7]} c={(seed + li + i) % 3 === 0 ? c : boxTones[(seed + li * 2 + i) % 4]} />))}
  </group>;
}
function Truck({ c = '#d64541' }: { c?: string }) {
  return <group>
    <B p={[1.55, .95, 0]} s={[1.2, 1.3, 1.75]} c={c} /><B p={[2.1, 1.25, 0]} s={[.1, .55, 1.5]} c="#9fd3ea" />
    <B p={[-.55, 1.3, 0]} s={[3, 1.9, 1.85]} c="#eef2f5" /><B p={[-.55, 1.3, .93]} s={[2.6, .35, .02]} c={c} />
    <B p={[.5, .45, 0]} s={[4.2, .2, 1.4]} c="#2b333a" />
    {[1.6, -.2, -1.4].flatMap(x => [-.8, .8].map(z => <Wheel key={x + '' + z} p={[x, .34, z]} />))}
  </group>;
}
function Forklift({ c = '#f2b705' }: { c?: string }) {
  return <group>
    <B p={[0, .55, -.15]} s={[1, .7, 1.3]} c={c} /><B p={[0, .75, -.75]} s={[.95, .5, .3]} c="#3a3f45" />
    {[-.42, .42].flatMap(x => [-.55, .3].map(z => <B key={x + '' + z} p={[x, 1.45, z]} s={[.06, 1.1, .06]} c="#2b2f33" />))}
    <B p={[0, 2, -.12]} s={[.95, .06, 1]} c="#2b2f33" />
    {[-.3, .3].map(x => <B key={x} p={[x, 1.2, .62]} s={[.08, 2.1, .08]} c="#555c63" />)}
    {[-.25, .25].map(x => <B key={x} p={[x, .12, .95]} s={[.1, .05, .8]} c="#7a8288" />)}
    {[-.45, .45].flatMap(x => [-.6, .35].map(z => <Wheel key={x + '' + z} p={[x, .25, z]} r={.25} w={.2} />))}
  </group>;
}
function Tank({ c = '#c9d3dc' }: { c?: string }) {
  return <group><C p={[0, 1.4, 0]} rt={.85} h={2.8} c={c} /><S p={[0, 2.8, 0]} rad={.85} c={c} sc={[1, .35, 1]} />
    <C p={[0, .9, 0]} rt={.87} h={.08} c="#f2b705" /><C p={[0, 2.1, 0]} rt={.87} h={.08} c="#f2b705" />
    <B p={[.86, 1.4, 0]} s={[.05, 2.8, .25]} c="#5d6b78" /></group>;
}
function Container({ c = '#c0392b', h = 0 }: { c?: string; h?: number }) {
  const y = .7 + h * 1.42;
  return <group><B p={[0, y, 0]} s={[3.4, 1.4, 1.3]} c={c} />
    {[-1.2, -.6, 0, .6, 1.2].map(x => <B key={x} p={[x, y, .66]} s={[.06, 1.3, .02]} c="#00000033" o={.25} />)}</group>;
}
function Machine({ c = '#7f93a8' }: { c?: string }) {
  return <group><B p={[0, .65, 0]} s={[1.6, 1.3, 1.2]} c={c} /><B p={[.2, .9, .61]} s={[.7, .45, .02]} c="#9fd3ea" o={.8} />
    <B p={[-.55, 1.05, .61]} s={[.3, .22, .02]} c="#56e3c5" e="#2bbf9f" /><B p={[0, 1.33, 0]} s={[1.6, .06, 1.2]} c="#f2b705" />
    <C p={[.55, 1.6, -.3]} rt={.04} h={.5} c="#888" /><S p={[.55, 1.9, -.3]} rad={.07} c="#ff5a3c" e="#ff3b1f" /></group>;
}
function Conveyor() {
  return <group><B p={[0, .72, 0]} s={[4, .14, .85]} c="#2b3640" /><B p={[0, .8, 0]} s={[3.9, .03, .7]} c="#14191e" />
    {[-1.8, -.6, .6, 1.8].flatMap(x => [-.35, .35].map(z => <B key={x + '' + z} p={[x, .33, z]} s={[.08, .66, .08]} c="#5d6b78" />))}
    {[-1.3, 0, 1.2].map(x => <B key={x} p={[x, 1.02, 0]} s={[.45, .4, .45]} c="#64b7b0" />)}</group>;
}
function Robot() {
  return <group><C p={[0, .2, 0]} rt={.5} h={.4} c="#3a4550" /><C p={[0, .6, 0]} rt={.3} h={.4} c="#f08a24" />
    <B p={[0, 1.15, .15]} s={[.28, 1, .28]} c="#f08a24" r={[.35, 0, 0]} /><S p={[0, 1.6, .33]} rad={.18} c="#3a4550" />
    <B p={[0, 1.65, .85]} s={[.22, .22, 1]} c="#f08a24" /><B p={[0, 1.5, 1.38]} s={[.18, .3, .1]} c="#3a4550" /></group>;
}
function Bench({ c = '#e9eef2', n = 0 }: { c?: string; n?: number }) {
  const items = ['#4aa3d9', '#e86a5c', '#56c28a', '#bb91e5', '#f2b705'];
  return <group><B p={[0, .45, 0]} s={[2.5, .85, .9]} c="#9fb3c4" /><B p={[0, .92, 0]} s={[2.6, .08, 1]} c={c} />
    {[-.9, -.5, -.1, .5, .9].map((x, i) => <C key={x} p={[x, 1.1, (i % 2 ? .15 : -.15)]} rt={.07} h={.28} c={items[(i + n) % 5]} />)}
    <B p={[0, 1.6, -.45]} s={[2.4, .05, .3]} c="#cfd8df" /></group>;
}
function Cabinet({ c = '#dfe6ec' }: { c?: string }) {
  return <group><B p={[0, 1, 0]} s={[1.2, 2, .7]} c={c} /><B p={[0, 1, .36]} s={[.02, 1.9, .02]} c="#9aa6ae" />
    <B p={[-.1, 1.1, .37]} s={[.04, .25, .03]} c="#5d6b78" /><B p={[.1, 1.1, .37]} s={[.04, .25, .03]} c="#5d6b78" /></group>;
}
function Hood() {
  return <group><B p={[0, .45, 0]} s={[1.6, .9, .9]} c="#9fb3c4" /><B p={[0, 1.95, -.1]} s={[1.6, 1.2, .7]} c="#dfe6ec" />
    <B p={[0, 1.45, .3]} s={[1.5, .9, .04]} c="#bfe6f3" o={.45} /><B p={[0, 2.7, -.1]} s={[.5, .3, .5]} c="#b7c2ca" /></group>;
}
function Crop({ n = 10, c = '#4f9a4a', fruit }: { n?: number; c?: string; fruit?: string }) {
  return <group><B p={[0, .12, 0]} s={[5, .25, .9]} c="#6b4a2b" />
    {Array.from({ length: n }, (_, i) => { const x = -2.25 + i * (4.5 / (n - 1)); return <group key={i} position={[x, .25, 0]}>
      <S p={[0, .3, 0]} rad={.27} c={i % 3 === 0 ? '#5eae55' : c} sc={[1, 1.2, 1]} />{fruit && i % 2 === 0 && <S p={[.15, .45, .12]} rad={.08} c={fruit} />}</group> })}</group>;
}
function Barn() {
  return <group><B p={[0, 1.1, 0]} s={[3.4, 2.2, 2.8]} c="#b5432f" />
    <mesh position={[0, 2.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[1.05, 1.05, 3.5, 3]} /><meshStandardMaterial color="#5a2a22" /></mesh>
    <B p={[0, .8, 1.41]} s={[1.3, 1.6, .02]} c="#f1ece4" /><B p={[0, .8, 1.43]} s={[1.2, .08, .02]} c="#b5432f" r={[0, 0, .9]} /></group>;
}
function Tractor() {
  return <group><B p={[0, .85, .35]} s={[.8, .7, 1.4]} c="#3b8f3a" /><B p={[0, 1.55, -.45]} s={[.95, .9, .9]} c="#9fd3ea" o={.6} />
    <B p={[0, 2.03, -.45]} s={[1.05, .08, 1.05]} c="#3b8f3a" /><C p={[.15, 1.5, .8]} rt={.05} h={.6} c="#333" />
    {[-.6, .6].map(x => <Wheel key={x} p={[x, .55, -.55]} r={.55} w={.3} />)}{[-.5, .5].map(x => <Wheel key={x} p={[x, .32, .85]} r={.32} w={.22} />)}</group>;
}
function Fence({ s, c = '#9aa6ae' }: { s: V3; c?: string }) {
  const n = Math.max(2, Math.round(s[0] / 1.5));
  return <group>{Array.from({ length: n + 1 }, (_, i) => <B key={i} p={[-s[0] / 2 + i * s[0] / n, s[1] / 2, 0]} s={[.08, s[1], .08]} c={c} />)}
    <B p={[0, s[1] * .9, 0]} s={[s[0], .05, .05]} c={c} /><B p={[0, s[1] * .4, 0]} s={[s[0], .05, .05]} c={c} />
    <B p={[0, s[1] / 2, 0]} s={[s[0], s[1], .01]} c={c} o={.18} /></group>;
}

function DecorItem({ d }: { d: D }) {
  const pos: V3 = [d.p[0], 0, d.p[1]];
  let el: React.ReactNode = null;
  switch (d.k) {
    case 'rack': el = <Rack c={d.c} seed={d.n} />; break;
    case 'truck': el = <Truck c={d.c} />; break;
    case 'forklift': el = <Forklift c={d.c} />; break;
    case 'tank': el = <Tank c={d.c} />; break;
    case 'container': el = <Container c={d.c} h={d.h} />; break;
    case 'machine': el = <Machine c={d.c} />; break;
    case 'conveyor': el = <Conveyor />; break;
    case 'robot': el = <Robot />; break;
    case 'bench': el = <Bench c={d.c} n={d.n} />; break;
    case 'cabinet': el = <Cabinet c={d.c} />; break;
    case 'hood': el = <Hood />; break;
    case 'crop': el = <Crop c={d.c} n={d.n} fruit={d.c === '#7cb342' ? '#e9654d' : undefined} />; break;
    case 'barn': el = <Barn />; break;
    case 'tractor': el = <Tractor />; break;
    case 'wall': el = <B p={[0, d.s![1] / 2, 0]} s={d.s!} c={d.c || '#c5cfd6'} />; break;
    case 'fence': el = <Fence s={d.s!} c={d.c} />; break;
    case 'tree': el = <group scale={d.h || 1}><C p={[0, .5, 0]} rt={.1} rb={.14} h={1} c="#6b4a2b" /><S p={[0, 1.45, 0]} rad={.7} c={d.c || '#3f8f46'} /><S p={[.25, 1.95, .1]} rad={.45} c="#4ea455" /></group>; break;
    case 'lamp': el = <group><C p={[0, 1.6, 0]} rt={.06} h={3.2} c="#5d6b78" /><B p={[0, 3.2, .25]} s={[.25, .08, .6]} c="#5d6b78" /><B p={[0, 3.14, .45]} s={[.2, .03, .25]} c="#fff6c8" e="#fff1a0" /></group>; break;
    case 'tlight': el = <group><C p={[0, 1.3, 0]} rt={.05} h={2.6} c="#3a4148" /><B p={[0, 2.7, 0]} s={[.3, .8, .25]} c="#22282d" />
      {[['#ff4d3d', 2.95], ['#f2b705', 2.7], ['#3ddc84', 2.45]].map(([c, y]) => <S key={c} p={[0, y as number, .13]} rad={.08} c={c as string} e={c as string} />)}</group>; break;
    case 'bin': el = <group><C p={[0, .4, 0]} rt={.28} rb={.25} h={.8} c={d.c || '#2f8f5a'} /><C p={[0, .82, 0]} rt={.31} h={.05} c="#22282d" /></group>; break;
    case 'stack': el = <group><B p={[0, .08, 0]} s={[1.2, .16, 1.2]} c="#9e744b" />
      {[[-.28, -.28], [.28, -.28], [-.28, .28], [.28, .28]].flatMap(([x, z], i) => [.42, .97].map((y, j) => (i + j) % 4 === 3 && j ? null : <B key={i + '-' + j} p={[x, y, z]} s={[.54, .52, .54]} c={(i + j) % 2 ? (d.c || '#d9893b') : boxTones[(i + j) % 4]} />))}</group>; break;
    case 'booth': el = <group><B p={[0, 1.1, 0]} s={[1.5, 2.2, 1.5]} c="#e6ecf1" /><B p={[0, 1.4, .76]} s={[1.1, .7, .02]} c="#9fd3ea" /><B p={[0, 2.3, 0]} s={[1.8, .15, 1.8]} c="#c0392b" /></group>; break;
    case 'counter': el = <group><B p={[0, .5, 0]} s={[2.2, 1, .8]} c="#3a5872" /><B p={[0, 1.02, 0]} s={[2.3, .05, .9]} c="#d8e2ea" /><B p={[.6, 1.25, 0]} s={[.4, .3, .05]} c="#1d252c" /></group>; break;
    case 'plant': el = <group><C p={[0, .25, 0]} rt={.25} rb={.18} h={.5} c="#b9643c" /><S p={[0, .8, 0]} rad={.38} c="#3f8f46" /></group>; break;
    case 'desk': el = <group><B p={[0, .75, 0]} s={[1.8, .06, .9]} c="#d8c3a5" />{[-.8, .8].map(x => <B key={x} p={[x, .37, 0]} s={[.06, .74, .8]} c="#5d6b78" />)}
      <B p={[0, 1.1, -.25]} s={[.7, .45, .04]} c="#1d252c" /><B p={[0, 1.1, -.22]} s={[.64, .38, .01]} c="#3fb6c9" e="#1d8fa3" /></group>; break;
    case 'barrier': el = <group>{[-d.s![0] / 2, d.s![0] / 2].map(x => <B key={x} p={[x, .45, 0]} s={[.12, .9, .12]} c="#555c63" />)}
      {Array.from({ length: Math.round(d.s![0] / .5) }, (_, i) => <B key={i} p={[-d.s![0] / 2 + .25 + i * .5, .85, 0]} s={[.5, .12, .08]} c={i % 2 ? '#fff' : '#e03a2f'} />)}</group>; break;
    case 'line': return <Flat p={d.p} w={d.s![0]} d={d.s![2]} c={d.c || '#f2c230'} />;
    case 'zebra': return <group>{Array.from({ length: 6 }, (_, i) => <Flat key={i} p={[d.p[0] - d.s![0] / 2 + .25 + i * d.s![0] / 6, d.p[1]]} w={.3} d={d.s![2]} c="#f4f4f4" />)}</group>;
    case 'road': return <group><mesh position={[d.p[0], .008, d.p[1]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[d.s![0], d.s![2]]} /><meshStandardMaterial color={d.c || '#3a4046'} /></mesh>
      {Array.from({ length: Math.floor(d.s![0] / 1.2) }, (_, i) => <Flat key={i} p={[d.p[0] - d.s![0] / 2 + .6 + i * 1.2, d.p[1]]} w={.6} d={.08} c="#f4f4f4" />)}</group>;
    case 'hatch': return <group>{Array.from({ length: Math.round(d.s![0] / .4) }, (_, i) => <mesh key={i} position={[d.p[0] - d.s![0] / 2 + .2 + i * .4, .013, d.p[1]]} rotation={[-Math.PI / 2, 0, .6]}><planeGeometry args={[.14, d.s![2] * 1.1]} /><meshStandardMaterial color="#f2c230" /></mesh>)}</group>;
  }
  return <group position={pos} rotation={[0, d.r || 0, 0]}>{el}</group>;
}

/* ------------------------------------------------------------------ entornos */
type Env = { title: string; hint: string; floor: string; outside: string; sky: string; grid: string; decor: D[] };
const RIGHT = Math.PI / 2;
function perimeter(kind: 'wall' | 'fence', c?: string, gate = true, h = kind === 'wall' ? 2.4 : 1.4, front = h): D[] {
  const t = kind === 'wall' ? .25 : .15;
  return [
    { k: kind, p: [0, -6.6], s: [18.2, h, t], c },
    ...(gate ? [{ k: kind, p: [-5.3, 6.6], s: [7.6, front, t], c }, { k: kind, p: [5.3, 6.6], s: [7.6, front, t], c }] as D[] : [{ k: kind, p: [0, 6.6], s: [18.2, front, t], c }] as D[]),
    { k: kind, p: [-9.1, 0], s: [13.2, h, t], r: RIGHT, c }, { k: kind, p: [9.1, 0], s: [13.2, h, t], r: RIGHT, c },
  ];
}
function trees(c?: string): D[] {
  const out: D[] = [];
  for (let x = -10.5; x <= 10.5; x += 2.6) { out.push({ k: 'tree', p: [x, -8 - (Math.abs(x * 7) % 1) * .6], h: 1 + (Math.abs(x * 13) % 3) * .12, c }); if (Math.abs(x) > 2.4) out.push({ k: 'tree', p: [x + .4, 8.1], h: .9 + (Math.abs(x * 5) % 3) * .1, c }) }
  for (let z = -5.5; z <= 6; z += 2.7) { out.push({ k: 'tree', p: [-10.6, z], h: 1.05, c }); out.push({ k: 'tree', p: [10.6, z + .6], h: .95, c }) }
  return out;
}
const lines = (c = '#f2c230'): D[] => [
  { k: 'line', p: [0, -3.15], s: [17.4, 0, .12], c }, { k: 'line', p: [0, 4.35], s: [17.4, 0, .12], c },
  { k: 'line', p: [-5.7, .6], s: [.12, 0, 7.5], c }, { k: 'line', p: [5.7, .6], s: [.12, 0, 7.5], c },
];

export const ENVS: Record<Sector, Env> = {
  seguridad: {
    title: 'Planta industrial · Seguridad', hint: 'Casco 1 = zona restringida · Casco 2 = zona de acceso · automóvil en movimiento',
    floor: '#6f7c82', outside: '#4f8c46', sky: '#b9d5e4', grid: '#7d8b91',
    decor: [...perimeter('fence', '#a7b3bb'), ...trees(), ...lines(),
      { k: 'rack', p: [-7, -5.5], c: '#d9893b', n: 0 }, { k: 'rack', p: [-3.5, -5.5], c: '#d9893b', n: 2 }, { k: 'rack', p: [-7, -4], c: '#c97a2e', n: 1 },
      { k: 'stack', p: [.6, -5] }, { k: 'stack', p: [2.1, -5], c: '#e3a857' }, { k: 'hatch', p: [5.6, -5.1], s: [4.4, 0, 2.4] },
      { k: 'tank', p: [4.6, -5.2] }, { k: 'tank', p: [6.6, -5.2] }, { k: 'machine', p: [8.2, -2.4], r: -RIGHT, c: '#6f87a0' },
      { k: 'truck', p: [7.5, 1.6], r: RIGHT, c: '#2f80c9' }, { k: 'forklift', p: [-7.4, 1.4] },
      { k: 'bin', p: [-8.3, 5] }, { k: 'bin', p: [-7.5, 5], c: '#3b6fb5' }, { k: 'bin', p: [-6.7, 5], c: '#c9a227' },
      { k: 'stack', p: [5.2, 5.3] }, { k: 'stack', p: [6.7, 5.3], c: '#c97a2e' }, { k: 'lamp', p: [-2.2, 6.2] }, { k: 'lamp', p: [2.2, 6.2] },
      { k: 'road', p: [-1.2, 2.4], s: [6.8, 0, 1.7] }, { k: 'zebra', p: [0, 5.6], s: [3, 0, 1.1] }],
  },
  manufactura: {
    title: 'Línea de manufactura', hint: 'Cintas transportadoras, brazos robóticos, CNC · pieza con posible defecto',
    floor: '#5f6b73', outside: '#2c3a44', sky: '#1d2b36', grid: '#6c7880',
    decor: [...perimeter('wall', '#b8c4cc', false, 2.6, .5), ...lines(),
      { k: 'conveyor', p: [-5.2, -4.3] }, { k: 'conveyor', p: [-1, -4.3] }, { k: 'robot', p: [-5.2, -5.7] }, { k: 'robot', p: [-1, -5.7] },
      { k: 'machine', p: [3.4, -5.4], c: '#6f87a0' }, { k: 'machine', p: [5.4, -5.4] }, { k: 'machine', p: [7.4, -5.4], c: '#58708a' },
      { k: 'machine', p: [8, -1.6], r: -RIGHT }, { k: 'machine', p: [8, 1.2], r: -RIGHT, c: '#6f87a0' }, { k: 'cabinet', p: [-8.4, -3.6], r: RIGHT, c: '#c94f4f' },
      { k: 'bench', p: [-7.9, .2], r: RIGHT, n: 1 }, { k: 'bench', p: [-7.9, 3.3], r: RIGHT, n: 3 },
      { k: 'stack', p: [4.6, 5.3], c: '#64b7b0' }, { k: 'stack', p: [6.2, 5.3], c: '#64b7b0' }, { k: 'stack', p: [7.8, 5.3], c: '#8d9fb3' },
      { k: 'bin', p: [-5, 5.7], c: '#c9a227' }, { k: 'bin', p: [-4.2, 5.7], c: '#c0392b' }, { k: 'forklift', p: [-7.4, 5.3], r: RIGHT },
      { k: 'hatch', p: [-3.1, -2.6], s: [8.2, 0, .5] }],
  },
  retail: {
    title: 'Almacén inteligente · Retail', hint: 'Pasillos de estantería, montacargas y zona de despacho',
    floor: '#7b858c', outside: '#33424d', sky: '#1f2e3a', grid: '#88939a',
    decor: [...perimeter('wall', '#d4dbe0', false, 2.8, .5), ...lines(),
      ...[-6.6, -3.1, .4, 3.9].flatMap((x, i) => [{ k: 'rack', p: [x, -5.5], c: ['#d9893b', '#3b82c4', '#c94f4f', '#4caf7a'][i], n: i } as D, { k: 'rack', p: [x, -3.95], c: ['#4caf7a', '#d9893b', '#3b82c4', '#c94f4f'][i], n: i + 2 } as D]),
      { k: 'rack', p: [8, -1.4], r: RIGHT, c: '#d9893b', n: 4 }, { k: 'forklift', p: [7.2, 2.6] }, { k: 'stack', p: [7.7, 5.2] }, { k: 'stack', p: [6.1, 5.2], c: '#3b82c4' },
      { k: 'counter', p: [-6.5, 5.3] }, { k: 'counter', p: [-3.5, 5.3] }, { k: 'plant', p: [-8.4, 5.9] }, { k: 'plant', p: [-1.6, 5.9] },
      { k: 'hatch', p: [6.9, 5.2], s: [3.6, 0, 1.6] }],
  },
  transporte: {
    title: 'Patio de transporte y logística', hint: 'Contenedores, camiones, garita de control y vía de circulación',
    floor: '#4a5157', outside: '#5b7a4d', sky: '#bcd3e0', grid: '#555d63',
    decor: [...perimeter('fence', '#8d99a3'), ...trees('#47884a'),
      { k: 'container', p: [-7, -5.4], c: '#c0392b' }, { k: 'container', p: [-7, -5.4], c: '#2e86c1', h: 1 }, { k: 'container', p: [-3.4, -5.4], c: '#27ae60' },
      { k: 'container', p: [.2, -5.4], c: '#16a085' }, { k: 'container', p: [.2, -5.4], c: '#d35400', h: 1 }, { k: 'container', p: [3.8, -5.4], c: '#7f8c8d' },
      { k: 'container', p: [-7, -3.95], c: '#f39c12' }, { k: 'container', p: [-3.4, -3.95], c: '#8e44ad' },
      { k: 'truck', p: [7.5, -2.6], r: RIGHT, c: '#e67e22' }, { k: 'truck', p: [7.5, 2.4], r: RIGHT, c: '#2f80c9' },
      { k: 'booth', p: [-2.7, 5.5] }, { k: 'barrier', p: [0, 5.9], s: [3, 1, .15] }, { k: 'tlight', p: [2.2, 5.6] },
      { k: 'lamp', p: [-8.4, 3.6] }, { k: 'lamp', p: [5.3, -3.5] }, { k: 'road', p: [-1.5, .6], s: [13.5, 0, 3.8], c: '#3d4349' },
      ...[-8, -6.8, -5.6, -4.4].map(x => ({ k: 'line', p: [x, 5.1], s: [.1, 0, 1.8], c: '#f4f4f4' }) as D), { k: 'line', p: [-6.2, 4.2], s: [3.7, 0, .1], c: '#f4f4f4' }],
  },
  agricultura: {
    title: 'Campo agrícola', hint: 'Surcos de cultivo, granero, tanque de riego y tractor',
    floor: '#8a7350', outside: '#5d9a4a', sky: '#c4dde9', grid: '#8a7350',
    decor: [...perimeter('fence', '#8b5a2b', true, 1.1), ...trees(),
      ...[-5.6, -4.5, -3.4].flatMap((z, i) => [{ k: 'crop', p: [-5, z], n: 10, c: i === 1 ? '#7cb342' : '#4f9a4a' } as D, { k: 'crop', p: [.6, z], n: 10, c: i === 0 ? '#7cb342' : '#5a9e3e' } as D]),
      { k: 'barn', p: [6.6, -4.7] }, { k: 'tank', p: [8, -1], c: '#7fa8c9' }, { k: 'tractor', p: [7.4, 2.4] }, { k: 'stack', p: [3.6, -5], c: '#d9b44a' },
      { k: 'crop', p: [-5.5, 4.9], n: 10, c: '#7cb342' }, { k: 'crop', p: [-5.5, 5.9], n: 10 }, { k: 'crop', p: [5.4, 5.4], n: 10, c: '#6aa84f' },
      { k: 'tree', p: [-8.2, 1.4], h: 1.1 }, { k: 'tree', p: [-8.2, -1.2], h: .95, c: '#4a9a3f' }, { k: 'bin', p: [3.4, 3.9], c: '#2e6fa7' }],
  },
  salud: {
    title: 'Laboratorio de investigación', hint: 'Mesas de muestras, cabinas de seguridad biológica y archivo',
    floor: '#cdd8df', outside: '#9aa9b4', sky: '#24323d', grid: '#b9c6ce',
    decor: [...perimeter('wall', '#e3e9ee', false, 2.6, .5), ...lines('#4aa3d9'),
      { k: 'bench', p: [-6.6, -5.3], n: 0 }, { k: 'bench', p: [-3.4, -5.3], n: 2 }, { k: 'bench', p: [-.2, -5.3], n: 4 },
      { k: 'hood', p: [3.6, -5.8] }, { k: 'hood', p: [5.6, -5.8] }, { k: 'cabinet', p: [7.7, -5.9] },
      { k: 'cabinet', p: [8.4, -3], r: -RIGHT }, { k: 'cabinet', p: [8.4, -1.6], r: -RIGHT, c: '#cfe0ea' }, { k: 'cabinet', p: [8.4, -.2], r: -RIGHT },
      { k: 'bench', p: [-7.9, 1], r: RIGHT, n: 1 }, { k: 'desk', p: [5.2, 5.4] }, { k: 'desk', p: [7.4, 5.4] },
      { k: 'plant', p: [-8.3, 5.9] }, { k: 'plant', p: [-6, 5.9] }, { k: 'bin', p: [3.4, 5.8], c: '#e8b23a' }],
  },
};

const Environment = memo(function Environment({ sector }: { sector: Sector }) {
  const env = ENVS[sector];
  return <>
    <color attach="background" args={[env.sky]} />
    <fog attach="fog" args={[env.sky, 34, 70]} />
    <mesh position={[0, -.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[60, 50]} /><meshStandardMaterial color={env.outside} /></mesh>
    <mesh position={[0, -.05, 0]} receiveShadow><boxGeometry args={[18.4, .1, 13.4]} /><meshStandardMaterial color={env.floor} /></mesh>
    <gridHelper args={[18, 18, env.grid, env.grid]} position={[0, .005, 0]} scale={[1, 1, 13 / 18]} />
    {env.decor.map((d, i) => <DecorItem key={i} d={d} />)}
  </>;
});

/* ------------------------------------------------------------------ objetos detectables */
export function Model({item,active}:{item:Item;active:boolean}){const c=colors[item.kind]||'#83aabb';const k=item.kind;return <group position={item.pos}>
{k==='helmet'?<><mesh position={[0,.35,0]}><sphereGeometry args={[.34,20,12,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color={c}/></mesh><mesh position={[0,.34,.13]}><boxGeometry args={[.75,.08,.32]}/><meshStandardMaterial color={c}/></mesh></>:null}
{k==='cone'?<><mesh position={[0,.08,0]}><boxGeometry args={[.75,.16,.75]}/><meshStandardMaterial color="#28384b"/></mesh><mesh position={[0,.54,0]}><coneGeometry args={[.32,.95,24]}/><meshStandardMaterial color={c}/></mesh></>:null}
{['car','truck'].includes(k)?<><mesh position={[0,.52,0]}><boxGeometry args={[k==='truck'?2.5:2,.55,1.05]}/><meshStandardMaterial color={c}/></mesh><mesh position={[-.22,.98,0]}><boxGeometry args={[1,.43,.92]}/><meshStandardMaterial color="#a8dbef"/></mesh>{[-.7,.7].flatMap(x=>[-.56,.56].map(z=><mesh key={`${x}-${z}`} position={[x,.27,z]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.23,.23,.12,16]}/><meshStandardMaterial color="#172635"/></mesh>))}</>:null}
{['box','product','defect','sample'].includes(k)?<mesh position={[0,.48,0]}><boxGeometry args={[.9,.9,.85]}/><meshStandardMaterial color={c}/></mesh>:null}
{k==='pallet'?<mesh position={[0,.18,0]}><boxGeometry args={[1.7,.32,1.15]}/><meshStandardMaterial color={c}/></mesh>:null}
{k==='shelf'?<group>{[.25,1.15,2].map(y=><mesh key={y} position={[0,y,0]}><boxGeometry args={[2,.13,.7]}/><meshStandardMaterial color={c}/></mesh>)}{[-.9,.9].map(x=><mesh key={x} position={[x,1.1,0]}><boxGeometry args={[.13,2.2,.75]}/><meshStandardMaterial color={c}/></mesh>)}</group>:null}
{k==='machine'?<><mesh position={[0,.7,0]}><boxGeometry args={[1.5,1.4,1.1]}/><meshStandardMaterial color={c}/></mesh><mesh position={[0,1.2,.58]}><boxGeometry args={[.6,.3,.08]}/><meshStandardMaterial color="#56e3c5"/></mesh></>:null}
{['plant','leaf','fruit'].includes(k)?<><mesh position={[0,.65,0]}><cylinderGeometry args={[.07,.1,1.3,8]}/><meshStandardMaterial color="#4f9561"/></mesh>{[-.3,.3].map((x,i)=><mesh key={i} position={[x,1.05,0]} rotation={[0,0,x]}><sphereGeometry args={[.38,.15,.18,12]}/><meshStandardMaterial color={k==='leaf'?c:'#5eae65'}/></mesh>)}{k==='fruit'?<mesh position={[.15,1.3,0]}><sphereGeometry args={[.28,16,12]}/><meshStandardMaterial color={c}/></mesh>:null}</>:null}
{k==='microscope'?<><mesh position={[0,.2,0]}><cylinderGeometry args={[.65,.65,.16,16]}/><meshStandardMaterial color={c}/></mesh><mesh position={[0,.95,0]} rotation={[0,0,.45]}><cylinderGeometry args={[.16,.16,1.3,12]}/><meshStandardMaterial color={c}/></mesh></>:null}
{k==='tray'?<mesh position={[0,.22,0]}><boxGeometry args={[1.5,.2,1.1]}/><meshStandardMaterial color={c}/></mesh>:null}
{active?<><mesh position={[0,1.1,0]}><boxGeometry args={[k==='car'||k==='truck'||k==='shelf'?2.9:1.7,2.6,k==='car'||k==='truck'?1.6:1.7]}/><meshBasicMaterial color="#31e7c7" wireframe transparent opacity={.75}/></mesh><Billboard position={[0,2.65,0]}><Text font={SCENE_FONT} fontSize={.25} color="#59ffdb" outlineWidth={.014} outlineColor="#071522">{item.label.toUpperCase()}</Text></Billboard></>:null}</group>}

function SafetyZone({ position, restricted }: { position: V3; restricted: boolean }) {
  const color = restricted ? '#ff6175' : '#39dca6';
  return <group position={[position[0], .02, position[2]]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.46, 1.58, 64]} /><meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={.9} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.46, 64]} /><meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={.14} depthWrite={false} /></mesh>
    <Text font={SCENE_FONT} position={[0, .03, -1.75]} rotation={[-Math.PI / 2, 0, 0]} fontSize={.24} color={color} outlineWidth={.012} outlineColor="#0b1a26">{restricted ? 'ZONA RESTRINGIDA' : 'ZONA DE ACCESO'}</Text>
  </group>;
}

/* ------------------------------------------------------------------ HANS */
type Body = { x: number; z: number; h: number; v: number };
const lerpAngle = (a: number, b: number, t: number) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t };

function Walker({ s, manual }: { s: MutableRefObject<Body>; manual: boolean }) {
  const g = useRef<THREE.Group>(null), lL = useRef<THREE.Group>(null), lR = useRef<THREE.Group>(null), aL = useRef<THREE.Group>(null), aR = useRef<THREE.Group>(null);
  const ph = useRef(0);
  useFrame((_, dt) => {
    const S = s.current; if (!g.current) return;
    g.current.position.set(S.x, 0, S.z);
    g.current.rotation.y = lerpAngle(g.current.rotation.y, S.h, Math.min(1, dt * 10));
    ph.current += dt * Math.min(S.v, 6) * 3.4;
    const sw = Math.min(1, S.v / 1.5) * Math.sin(ph.current) * .65;
    if (lL.current) lL.current.rotation.x = sw; if (lR.current) lR.current.rotation.x = -sw;
    if (aL.current) aL.current.rotation.x = -sw * .8; if (aR.current) aR.current.rotation.x = sw * .8;
  });
  return <group ref={g}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .02, 0]}><ringGeometry args={[.42, .5, 32]} /><meshBasicMaterial color={manual ? '#ffd23f' : '#31e7c7'} transparent opacity={.85} /></mesh>
    {[[-.13, lL], [.13, lR]].map(([x, r]) => <group key={x as number} ref={r as MutableRefObject<THREE.Group>} position={[x as number, .86, 0]}>
      <B p={[0, -.42, 0]} s={[.19, .84, .21]} c="#2c3e55" /><B p={[0, -.82, .07]} s={[.21, .1, .34]} c="#1b2530" /></group>)}
    <B p={[0, 1.22, 0]} s={[.56, .76, .32]} c="#ff8a1f" />
    <B p={[0, 1.08, 0]} s={[.58, .05, .34]} c="#f5f1d0" e="#a8a37a" /><B p={[0, 1.32, 0]} s={[.58, .05, .34]} c="#f5f1d0" e="#a8a37a" />
    {[[-.37, aL], [.37, aR]].map(([x, r]) => <group key={x as number} ref={r as MutableRefObject<THREE.Group>} position={[x as number, 1.55, 0]}>
      <B p={[0, -.32, 0]} s={[.15, .64, .17]} c="#2b8fd6" /><S p={[0, -.68, 0]} rad={.08} c="#e6b18d" /></group>)}
    <S p={[0, 1.83, 0]} rad={.23} c="#e6b18d" />
    <mesh position={[0, 1.93, 0]} castShadow><sphereGeometry args={[.27, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#ffd23f" /></mesh>
    <B p={[0, 1.94, .12]} s={[.5, .04, .3]} c="#ffd23f" />
    <B p={[0, 1.85, .22]} s={[.3, .06, .03]} c="#1d252c" />
    <Billboard position={[0, 2.5, 0]}><Text font={SCENE_FONT} fontSize={.26} color={manual ? '#ffe680' : '#8cf9e4'} outlineWidth={.02} outlineColor="#071522">{manual ? 'HANS · MANUAL' : 'HANS'}</Text></Billboard>
  </group>;
}

function Moving({ s, children }: { s: MutableRefObject<Body>; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) { g.current.position.set(s.current.x, 0, s.current.z); g.current.rotation.y = s.current.h } });
  return <group ref={g}>{children}</group>;
}

/* ------------------------------------------------------------------ mundo */
export type SceneProps = {
  sector: Sector; playing: boolean; threshold: number; mode: ControlMode; view: ViewMode; follow: boolean;
  keys: MutableRefObject<Keys>; onTick: (ids: string[], distance: Record<string, number>) => void;
  onRestrictedAttempt?: () => void;
};
const fw = new THREE.Vector3();
const HOME: Body = { x: -4.5, z: 0, h: Math.PI / 2, v: 0 };

function World({ sector, playing, threshold, mode, view, follow, keys, onTick, onRestrictedAttempt }: SceneProps) {
  const env = ENVS[sector];
  const colliders = useMemo(() => env.decor.map(footprint).filter((b): b is Box => !!b), [env]);
  const hans = useRef<Body>({ ...HOME });
  const car = useRef<Body>({ x: -1.2, z: 2.4, h: 0, v: 0 });
  const t = useRef(0), acc = useRef(0), activeKey = useRef('');
  const restrictedLatched = useRef(false);
  const restrictedCallback = useRef(onRestrictedAttempt);
  useEffect(() => { restrictedCallback.current = onRestrictedAttempt; }, [onRestrictedAttempt]);
  const [active, setActive] = useState<string[]>([]);
  const controls = useRef<any>(null);
  const camera = useThree(s => s.camera);

  useEffect(() => {
    if (view === '2d') camera.position.set(0, 25, .01); else camera.position.set(12, 14, 17.5);
    if (controls.current) { controls.current.target.set(0, 0, 0); controls.current.update() }
  }, [view, camera]);

  const restricted = (x: number, z: number) => {
    if (sector !== 'seguridad') return false;
    const zone = catalog.seguridad.find(o => o.id === 'helmet1')!;
    // Radio de la zona (1.58) + margen del cuerpo de HANS (0.30).
    return Math.hypot(x - zone.pos[0], z - zone.pos[2]) < 1.88;
  };
  const notifyRestriction = () => {
    if (!restrictedLatched.current) {
      restrictedLatched.current = true;
      restrictedCallback.current?.();
    }
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, .05);
    const H = hans.current;
    if (playing) {
      t.current += dt * .55;
      let mx = 0, mz = 0;
      if (mode === 'manual') {
        const k = keys.current;
        const f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
        const r = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
        if (f || r) {
          camera.getWorldDirection(fw); fw.y = 0;
          if (fw.lengthSq() < 1e-4) fw.set(0, 0, -1);
          fw.normalize();
          mx = fw.x * f - fw.z * r; mz = fw.z * f + fw.x * r;
          const l = Math.hypot(mx, mz) || 1, sp = (k.shift ? 5.5 : 3.2) * dt;
          mx = mx / l * sp; mz = mz / l * sp;
        }
      } else {
        const tx = Math.sin(t.current) * 4.25, tz = Math.sin(t.current * 1.7) * 1.8;
        const k = Math.min(1, dt * 6); mx = (tx - H.x) * k; mz = (tz - H.z) * k;
      }
      let nx = H.x + mx, nz = H.z + mz;
      nx = Math.max(-8.6, Math.min(8.6, nx));
      nz = Math.max(-6.1, Math.min(6.1, nz));
      // Aplicar las colisiones tanto al control manual como al automático.
      // Resolver por ejes permite deslizarse por el límite sin atravesarlo.
      // Si HANS ya aparece dentro de la zona (por posición inicial o versión previa),
      // avisar y permitirle salir. Si está fuera, impedir que ingrese.
      const insideNow = restricted(H.x, H.z);
      const wantsRestricted = restricted(nx, nz) || restricted(nx, H.z) || restricted(H.x, nz);
      if (insideNow || wantsRestricted) notifyRestriction();
      const zone = catalog.seguridad.find(o => o.id === 'helmet1');
      if (sector === 'seguridad' && zone &&
          Math.hypot(H.x - zone.pos[0], H.z - zone.pos[2]) > 2.35) {
        restrictedLatched.current = false;
      }
      const canMove = (x: number, z: number) => {
        // Permitir salir de la zona si HANS ya está dentro, pero nunca avanzar
        // hacia el centro de la zona restringida.
        if (sector === 'seguridad' && restricted(x, z)) {
          const zonePos = catalog.seguridad[0].pos;
          const before = Math.hypot(H.x - zonePos[0], H.z - zonePos[2]);
          const after = Math.hypot(x - zonePos[0], z - zonePos[2]);
          if (!restricted(H.x, H.z) || after <= before + 0.0001) return false;
        }
        return !colliders.some(b => x > b.x0 - .3 && x < b.x1 + .3 && z > b.z0 - .3 && z < b.z1 + .3);
      };
      if (!canMove(nx, H.z)) nx = H.x;
      if (!canMove(nx, nz)) nz = H.z;
      const moved = Math.hypot(nx - H.x, nz - H.z);
      if (moved > 1e-3) H.h = Math.atan2(nx - H.x, nz - H.z);
      H.v = moved / Math.max(dt, 1e-3); H.x = nx; H.z = nz;
      if (sector === 'seguridad') {
        const Cr = car.current, cx = -1.2 + Math.sin(t.current * 1.35) * 2.2, cz = 2.4 + Math.cos(t.current * 1.35) * .45;
        if (Math.hypot(cx - Cr.x, cz - Cr.z) > 1e-4) Cr.h = Math.atan2(-(cz - Cr.z), cx - Cr.x);
        Cr.x = cx; Cr.z = cz;
      }
    } else H.v = 0;

    if (follow && view === '3d' && controls.current) {
      const tg = controls.current.target, k = Math.min(1, dt * 3);
      const dx = (H.x - tg.x) * k, dz = (H.z - tg.z) * k;
      tg.x += dx; tg.z += dz; camera.position.x += dx; camera.position.z += dz;
    }
    if (!playing) return;
    const ds: Record<string, number> = {};
    const near = catalog[sector].filter(o => {
      const target = sector === 'seguridad' && o.id === 'car' ? [car.current.x, 0, car.current.z] : o.pos;
      const d = Math.hypot(target[0] - H.x, target[2] - H.z); ds[o.id] = d;
      const radius = sector === 'seguridad' && (o.id === 'helmet1' || o.id === 'helmet2') ? 1.58 : 1.9;
      return d < radius && o.confidence >= threshold;
    }).map(o => o.id);
    const key = near.join(',');
    if (key !== activeKey.current) { activeKey.current = key; setActive(near) }
    acc.current += dt;
    if (acc.current > .35) { acc.current = 0; onTick(near, ds) }
  });

  return <>
    <hemisphereLight args={['#eaf6ff', '#4a5a50', .9]} />
    <ambientLight intensity={.45} />
    <directionalLight position={[9, 16, 8]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-.0005} />
    <Environment sector={sector} />
    {sector === 'seguridad' && <><SafetyZone position={catalog.seguridad[0].pos} restricted /><SafetyZone position={catalog.seguridad[1].pos} restricted={false} /></>}
    {catalog[sector].map(o => sector === 'seguridad' && o.id === 'car'
      ? <Moving key={o.id} s={car}><Model item={{ ...o, pos: [0, 0, 0] }} active={active.includes(o.id)} /></Moving>
      : <Model key={o.id} item={o} active={active.includes(o.id)} />)}
    <Walker s={hans} manual={mode === 'manual'} />
    <OrbitControls ref={controls} makeDefault enablePan enableRotate={view === '3d'} minDistance={5} maxDistance={34}
      minPolarAngle={0} maxPolarAngle={view === '3d' ? Math.PI / 2.2 : 0.001} />
  </>;
}

export function SceneCanvas(props: SceneProps) {
  return <Canvas shadows dpr={[1, 2]} camera={{ position: [12, 14, 17.5], fov: 45 }}><World {...props} /></Canvas>;
}
