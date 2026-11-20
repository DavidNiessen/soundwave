/**
 * The player's band member on their own, in their look: a small 3D view of just that figure, drawn
 * on the page above the menus (not the stage behind them), playing their part on a loop. Used on
 * the Online tab, under the player's nametag.
 *
 * The figures' materials read the venue's shared uniforms (clock, beat, light). Where the stage
 * draws on the page too (no worker), those are the stage's own: they are set for the portrait just
 * before it draws, and put back right after.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Part } from '../chart/types';
import type { Avatar } from '../net/protocol';
import { loadBandSet } from '../render/aurora/assets';
import { Figures, type Person } from '../render/aurora/figures';
import { shared } from '../render/aurora/shared';

/** The band data's name for each part. */
const KEY: Record<Part, string> = { vocals: 'vox', lead: 'lead', bass: 'bass', drums: 'drums' };
/** A steady tempo for the loop, beats per second. */
const BPS = 2;

export function AvatarPortrait({ part, avatar }: { part: Part; avatar: Avatar | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const look = useRef(avatar);
  look.current = avatar;
  const restyle = useRef<(a: Avatar | null) => void>(() => {});

  useEffect(() => {
    const el = canvas.current!;
    let live = true;
    let raf = 0;
    let cleanup = () => {};
    void loadBandSet().then((set) => {
      if (!live) return;
      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
      const who = set.data.band?.[KEY[part]] ?? Object.values(set.data.band ?? {})[0];
      const figures = new Figures(set);
      const person: Person = {
        pos: [0, 0, 0],
        yaw: 0,
        scale: 1,
        character: who?.character ?? Object.keys(set.data.characters)[0],
        calm: who?.clip ?? '',
        hype: who?.clip ?? '',
        threshold: 2,
        phase: 0,
        spot: 1.3,
        part: KEY[part],
      };
      // The character's mesh is not built round its own feet: it is stood so that its middle is.
      const info = set.data.characters[person.character];
      const mesh = info ? set.scene.getObjectByName(info.mesh) : undefined;
      if (mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        const mid = box.getCenter(new THREE.Vector3());
        person.pos = [-mid.x, -box.min.y, -mid.z];
      }
      figures.add([person], true);
      scene.add(figures.group);
      restyle.current = (a) => {
        Object.assign(person, { top: a?.top, bottom: a?.bottom, finish: a?.finish, recolor: a ? 1 : 0 });
        figures.restyle(person);
      };
      restyle.current(look.current);

      // Framed head to toe, filling the height, as a character stands in a lobby.
      const size = () => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(el);
      camera.position.set(0, 1.0, 5.1);
      camera.lookAt(0, 1.02, 0);

      // The uniforms the portrait sets, kept to be put back for the stage.
      const saved = { time: 0, beat: 0, band: new THREE.Vector3(), feature: 0, energy: 0 };
      const start = performance.now();
      const frame = () => {
        raf = requestAnimationFrame(frame);
        const t = (performance.now() - start) / 1000;
        saved.time = shared.uTime.value;
        saved.beat = shared.uBeat.value;
        saved.band.copy(shared.uBand.value[0]);
        saved.feature = shared.uFeature.value[0];
        saved.energy = shared.uEnergy.value;
        shared.uTime.value = t;
        shared.uBeat.value = t * BPS;
        shared.uBand.value[0].set(0, 0, 0);
        shared.uFeature.value[0] = 1;
        shared.uEnergy.value = 0.6;
        // A slow sway, so the look shows from more than one side.
        figures.group.rotation.y = -0.2 + Math.sin(t * 0.35) * 0.25;
        renderer.render(scene, camera);
        shared.uTime.value = saved.time;
        shared.uBeat.value = saved.beat;
        shared.uBand.value[0].copy(saved.band);
        shared.uFeature.value[0] = saved.feature;
        shared.uEnergy.value = saved.energy;
      };
      frame();
      cleanup = () => {
        ro.disconnect();
        figures.dispose();
        renderer.dispose();
      };
    });
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, [part]);

  useEffect(() => restyle.current(avatar), [avatar]);

  return <canvas ref={canvas} className="avatar-portrait" aria-hidden />;
}
