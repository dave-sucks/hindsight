"use client";

import { useEffect, useRef, useCallback } from "react";

// ── GLSL Shaders ────────────────────────────────────────────────
const VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform float u_time;
  uniform vec2 u_resolution;

  // Simplex-like noise via hash
  vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x / 289.0) * 289.0; }
  vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187,  // (3.0-sqrt(3.0))/6.0
      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
     -0.577350269189626,  // -1.0 + 2.0 * C.x
      0.024390243902439   // 1.0 / 41.0
    );
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractional Brownian Motion
  float fbm(vec2 p) {
    float f = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
      f += w * snoise(p);
      p *= 2.0;
      w *= 0.5;
    }
    return f;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2(uv.x * aspect, uv.y);

    float t = u_time * 0.15;

    // Domain warping for liquid metal look
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.4),
      fbm(p + vec2(5.2, 1.3) + t * 0.3)
    );

    vec2 r = vec2(
      fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.2),
      fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * 0.25)
    );

    float f = fbm(p + 4.0 * r);

    // Color palette — dark metallic with purple/violet highlights
    vec3 darkBase = vec3(0.04, 0.03, 0.06);     // near-black with purple tint
    vec3 midTone  = vec3(0.08, 0.05, 0.14);     // dark purple
    vec3 highlight = vec3(0.25, 0.15, 0.45);     // violet
    vec3 accent   = vec3(0.35, 0.20, 0.55);      // brighter violet

    // Mix colors based on noise
    float n = f * 0.5 + 0.5;
    vec3 col = darkBase;
    col = mix(col, midTone, smoothstep(0.0, 0.4, n));
    col = mix(col, highlight, smoothstep(0.4, 0.7, n));
    col = mix(col, accent, smoothstep(0.7, 1.0, n));

    // Metallic specular highlights
    float spec = pow(max(0.0, snoise(p * 3.0 + t * 0.5)), 8.0);
    col += vec3(0.15, 0.10, 0.25) * spec * 0.6;

    // Subtle edge darkening (vignette)
    float vig = 1.0 - 0.4 * length(uv - 0.5);
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
  }
`;

interface LiquidMetalBgProps {
  className?: string;
  speed?: number;
}

export function LiquidMetalBg({ className = "", speed = 1.0 }: LiquidMetalBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const timeLocRef = useRef<WebGLUniformLocation | null>(null);
  const resLocRef = useRef<WebGLUniformLocation | null>(null);
  const startRef = useRef<number>(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const createShader = useCallback(
    (gl: WebGLRenderingContext, type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    glRef.current = gl;

    // Create program
    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Full-screen quad
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    timeLocRef.current = gl.getUniformLocation(program, "u_time");
    resLocRef.current = gl.getUniformLocation(program, "u_resolution");

    // Resize handler
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      // Render at reduced resolution for performance
      const scale = dpr > 1 ? 0.5 : 0.75;
      canvas.width = canvas.clientWidth * dpr * scale;
      canvas.height = canvas.clientHeight * dpr * scale;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    startRef.current = performance.now();

    const render = () => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      gl.uniform1f(timeLocRef.current, elapsed * speedRef.current);
      gl.uniform2f(resLocRef.current, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [createShader]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
