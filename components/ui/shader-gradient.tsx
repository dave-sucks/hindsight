"use client";

/**
 * ShaderGradient — a slow, grainy, flowing gradient drawn by one fragment
 * shader on a plain WebGL canvas (no three.js). Its three colors are read
 * from CSS variables (by default the brand blue as a deep wash over a
 * near-black ground made from it, and the active-holding blue as small
 * glints), so the theme owns the palette. Holds a still frame for reduced
 * motion, pauses with the tab, and falls back to a CSS gradient without WebGL.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uGround;
uniform vec3 uLightA;
uniform vec3 uLightB;

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
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = uv;
  p.x *= uRes.x / uRes.y;
  float t = uTime * 0.025;

  // Broad, slow folds: a soft mesh, not smoke.
  vec2 q = vec2(fbm(p * 0.7 + vec2(0.0, t)), fbm(p * 0.7 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 0.9 + 1.6 * q + vec2(1.7, 9.2) + t * 1.2), fbm(p * 0.9 + 1.6 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 0.6 + 1.8 * r);

  // A near-black ground, light B as a deep wash, light A only as small glints.
  vec3 col = uGround;
  col = mix(col, uLightB * 0.5, smoothstep(0.45, 1.05, length(q)) * 0.85);
  col = mix(col, uLightB * 0.75, smoothstep(0.6, 0.88, r.y) * 0.4);
  col = mix(col, uLightA, smoothstep(0.6, 0.86, f) * 0.45);
  col += uLightA * pow(clamp(f, 0.0, 1.0), 5.0) * 0.5;
  col *= 0.8 + 0.3 * uv.y;

  float g = hash(gl_FragCoord.xy + fract(uTime * 0.37) * 113.0) - 0.5;
  col += g * 0.045;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function readColor(cssVar: string): [number, number, number] {
  const fallback: [number, number, number] = [0, 0.52, 0.9];
  if (typeof window === "undefined") return fallback;
  // Resolve whatever the variable holds (hex, oklch) through the browser, then
  // paint one pixel to read it back as sRGB.
  const probe = document.createElement("span");
  probe.style.color = `var(${cssVar})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !css) return fallback;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

export function ShaderGradient({
  ground,
  lightA = "--color-blue-500",
  lightB = "--brand-blue",
  depth = 0.025,
  speed = 1,
  /** Render below full resolution: a gradient loses nothing, the GPU saves a lot. */
  resolution = 0.6,
  className,
}: {
  /** CSS variables for the ground and the two lights. With no ground, it's light B at `depth`. */
  ground?: string;
  lightA?: string;
  lightB?: string;
  depth?: number;
  speed?: number;
  resolution?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setFailed(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const b = readColor(lightB);
    gl.uniform3fv(gl.getUniformLocation(prog, "uGround"), ground ? readColor(ground) : [b[0] * depth, b[1] * depth, b[2] * depth]);
    gl.uniform3fv(gl.getUniformLocation(prog, "uLightA"), readColor(lightA));
    gl.uniform3fv(gl.getUniformLocation(prog, "uLightB"), b);

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * resolution;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now() - 40_000; // start mid-flow, not at the origin
    let raf = 0;
    const frame = (now: number) => {
      size();
      gl.uniform1f(uTime, ((now - start) / 1000) * speed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => still && requestAnimationFrame(frame)) : null;
    ro?.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [ground, lightA, lightB, depth, speed, resolution]);

  if (failed) {
    return (
      <div
        className={cn("size-full", className)}
        style={{
          background: `radial-gradient(70% 60% at 25% 30%, color-mix(in oklch, var(${lightA}) 35%, transparent), transparent 70%), radial-gradient(60% 60% at 80% 75%, color-mix(in oklch, var(${lightB}) 35%, transparent), transparent 70%), ${ground ? `var(${ground})` : `color-mix(in oklch, var(${lightB}) 6%, black)`}`,
        }}
      />
    );
  }
  return <canvas ref={ref} className={cn("block size-full", className)} aria-hidden />;
}
