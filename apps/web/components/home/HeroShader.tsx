"use client";

import { useEffect, useRef, useState } from "react";

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

// Domain-warped fractal noise: two layers of noise bend a third, which mixes three brand tints. Very slow.
const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 1.7;
  float t = u_time * 0.045;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p + 2.0 * q + vec2(0.6 * t, -0.4 * t));
  vec3 col = mix(u_a, u_b, smoothstep(0.25, 0.85, f));
  col = mix(col, u_c, 0.6 * smoothstep(0.5, 0.95, q.y));
  col = mix(u_a, col, smoothstep(0.0, 0.6, uv.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A six-digit hex token value → [r, g, b] in 0..1. The tints are design tokens (--color-shader-*), read at runtime. */
function tokenRgb(name: string): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(value)?.[1] ?? "f5f5f7";
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * The home hero's signature visual: a slow, light aurora of brand tints drawn by a WebGL fragment shader. Purely
 * decorative and built to cost nothing that matters:
 *  - renders at half resolution (it is soft by nature) and caps the pixel ratio;
 *  - pauses when the tab is hidden or the hero has scrolled away; one still frame under reduced motion;
 *  - fades in after its first frame, so a missing or lost WebGL context simply leaves the plain canvas colour;
 *  - the tints stay at least as light as the page canvas, so the hero text keeps its contrast.
 */
export default function HeroShader() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!el || !gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    gl.uniform3fv(gl.getUniformLocation(program, "u_a"), tokenRgb("--color-shader-a"));
    gl.uniform3fv(gl.getUniformLocation(program, "u_b"), tokenRgb("--color-shader-b"));
    gl.uniform3fv(gl.getUniformLocation(program, "u_c"), tokenRgb("--color-shader-c"));

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
    let frame = 0;
    let visible = true;
    let lost = false;
    const started = performance.now();

    const resize = () => {
      el.width = Math.max(1, Math.round(el.clientWidth * scale));
      el.height = Math.max(1, Math.round(el.clientHeight * scale));
      gl.viewport(0, 0, el.width, el.height);
      gl.uniform2f(uRes, el.width, el.height);
    };
    const draw = (now: number) => {
      if (lost) return;
      gl.uniform1f(uTime, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      setReady(true);
      if (!reduce && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden && !reduce) frame = requestAnimationFrame(draw);
    };

    resize();
    draw(performance.now());

    const sizes = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now());
    });
    sizes.observe(el);
    // Pause when the hero is off screen (this is the one sanctioned use: performance, not scroll effects).
    const Observer = window.IntersectionObserver; // design-check-ignore: pauses the shader off screen (performance)
    const onScreen = new Observer(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      resume();
    });
    onScreen.observe(el);
    document.addEventListener("visibilitychange", resume);
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      setReady(false);
    };
    el.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      onScreen.disconnect();
      document.removeEventListener("visibilitychange", resume);
      el.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-testid="hero-shader"
      data-ready={ready}
      className="h-full w-full opacity-0 transition-opacity duration-700 data-[ready=true]:opacity-100 motion-reduce:transition-none"
    />
  );
}
