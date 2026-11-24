"use client";
import { useEffect, useRef, useState } from "react";
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import { AgentState, Role, ROLES } from "@/lib/types";

type Point = { x: number; y: number };
type Actor = {
  role: Role;
  sprite: Sprite;
  ring: Graphics;
  home: Point;
  route: Point[];
  phase: "seated" | "walking" | "interaction";
  distance: number;
  wait: number;
  status: string;
  lastIdle: number;
  returning: boolean;
};
interface Props {
  agents: AgentState[];
  selected: Role | null;
  onSelect: (role: Role) => void;
  eco: boolean;
}
// Logical room coordinates, shared by navigation, furniture masks and hit targets.
const HOMES: Point[] = [
  { x: 326, y: 350 },
  { x: 764, y: 352 },
  { x: 327, y: 563 },
  { x: 804, y: 566 },
];
const AISLE: Point[] = [
  { x: 565, y: 378 },
  { x: 632, y: 388 },
  { x: 560, y: 535 },
  { x: 663, y: 547 },
];
const LABELS = [
  { x: 27.2, y: 34 },
  { x: 64, y: 34 },
  { x: 27, y: 66 },
  { x: 67, y: 67 },
];
const URLS = [
  "/office/staffroom.png",
  "/office/agents.png",
  "/office/working.png",
];
export default function OfficeScene({
  agents,
  selected,
  onSelect,
  eco,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    metrics = useRef<HTMLOutputElement>(null);
  const latest = useRef({ agents, selected, onSelect, eco });
  latest.current = { agents, selected, onSelect, eco };
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let disposed = false,
      initialized = false,
      cleaned = false;
    const app = new Application();
    const textures: Texture[] = [];
    const frames: Texture[] = [];
    let observer: ResizeObserver | undefined;
    let removeContext: undefined | (() => void);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => {
      reduced = motion.matches;
    };
    motion.addEventListener("change", onMotion);
    let samples: number[] = [];
    let lastFrame = 0,
      lastReport = 0,
      ticks = 0,
      updateMs = 0;
    const started = performance.now();
    let visibility: () => void = () => {};
    function cleanup() {
      if (cleaned || !initialized) return;
      cleaned = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      removeContext?.();
      app.stop();
      app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: false, textureSource: false },
      );
      for (const f of frames) f.destroy(false);
      for (const t of textures) t.destroy(true);
      target!.dataset.destroyed = "true";
    }
    async function imageTexture(url: string) {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (disposed) return null;
      const texture = Texture.from(image, true);
      textures.push(texture);
      return texture;
    }
    async function init() {
      try {
        await app.init({
          width: 1200,
          height: 675,
          backgroundAlpha: 0,
          antialias: false,
          preference: "webgl",
          resolution: 1,
          autoDensity: true,
          autoStart: false,
          powerPreference: "low-power",
        });
        initialized = true;
        if (disposed) {
          cleanup();
          return;
        }
        const [room, atlas, work] = await Promise.all(URLS.map(imageTexture));
        if (disposed) {
          cleanup();
          return;
        }
        if (!room || !atlas || !work)
          throw new Error("Не загрузились текстуры");
        target!.appendChild(app.canvas);
        app.canvas.setAttribute(
          "aria-label",
          "Изометрическая учительская с четырьмя интерактивными ИИ-агентами",
        );
        app.canvas.setAttribute("role", "img");
        const world = new Container();
        app.stage.addChild(world);
        const bg = new Sprite(room);
        bg.width = 1200;
        bg.height = 675;
        world.addChild(bg);
        const actorLayer = new Container();
        actorLayer.sortableChildren = true;
        world.addChild(actorLayer);
        const atlasFrames = [atlas, work].map((base) =>
          ROLES.map((_, row) =>
            Array.from({ length: 4 }, (_, col) => {
              const texture = new Texture({
                source: base.source,
                frame: new Rectangle(
                  (col * base.width) / 4,
                  (row * base.height) / 4,
                  base.width / 4,
                  base.height / 4,
                ),
              });
              frames.push(texture);
              return texture;
            }),
          ),
        );
        const actors: Actor[] = ROLES.map((role, i) => {
          const sprite = new Sprite(atlasFrames[1][i][0]);
          sprite.anchor.set(0.5, 1);
          sprite.width = 135;
          sprite.height = 133;
          sprite.position.copyFrom(HOMES[i]);
          sprite.eventMode = "static";
          sprite.cursor = "pointer";
          sprite.hitArea = new Rectangle(-100, -280, 200, 280);
          sprite.on("pointertap", () => latest.current.onSelect(role));
          const ring = new Graphics()
            .ellipse(0, 0, 27, 9)
            .fill({ color: 0xd7a4ff, alpha: 0.18 })
            .stroke({ color: 0xd8a4ff, width: 2, alpha: 0.8 });
          ring.position.copyFrom(HOMES[i]);
          ring.visible = false;
          ring.zIndex = HOMES[i].y - 1;
          actorLayer.addChild(ring, sprite);
          sprite.zIndex = HOMES[i].y;
          return {
            role,
            sprite,
            ring,
            home: HOMES[i],
            route: [],
            phase: "seated",
            distance: 0,
            wait: 0,
            status: "idle",
            lastIdle: started + i * 6000,
            returning: false,
          };
        });
        // Foreground fragments of the SAME room texture occlude seated legs behind desks.
        const polygons = [
          [
            260, 344, 381, 307, 385, 275, 458, 266, 451, 311, 519, 322, 519,
            398, 319, 453, 260, 413,
          ],
          [
            722, 325, 813, 300, 819, 275, 879, 266, 873, 307, 952, 324, 952,
            397, 796, 451, 723, 410,
          ],
          [
            269, 580, 347, 547, 350, 492, 477, 458, 483, 526, 542, 540, 542,
            647, 373, 675, 272, 675,
          ],
          [
            749, 571, 844, 538, 848, 512, 928, 488, 924, 544, 1003, 563, 1002,
            644, 899, 675, 755, 675,
          ],
        ];
        polygons.forEach((points) => {
          const xs = points.filter((_, i) => i % 2 === 0),
            ys = points.filter((_, i) => i % 2 === 1);
          const x = Math.min(...xs),
            y = Math.min(...ys),
            w = Math.max(...xs) - x,
            h = Math.max(...ys) - y;
          const texture = new Texture({
            source: room.source,
            frame: new Rectangle(
              (x / 1200) * room.width,
              (y / 675) * room.height,
              (w / 1200) * room.width,
              (h / 675) * room.height,
            ),
          });
          frames.push(texture);
          const mask = new Graphics().poly(points).fill(0xffffff);
          const part = new Sprite(texture);
          part.position.set(x, y);
          part.width = w;
          part.height = h;
          part.mask = mask;
          world.addChild(mask, part);
        });
        // A small slide indicator changes only while the creative agent is genuinely active.
        const slide = new Graphics();
        world.addChild(slide);
        slide.position.set(409, 520);
        slide.rotation = -0.24;
        const resize = () => {
          const w = target!.clientWidth,
            h = target!.clientHeight;
          if (!w || !h) return;
          app.renderer.resize(w, h);
          world.scale.set(w / 1200, h / 675);
        };
        observer = new ResizeObserver(resize);
        observer.observe(target!);
        resize();
        visibility = () => {
          if (document.hidden) app.stop();
          else {
            lastFrame = 0;
            app.start();
          }
        };
        document.addEventListener("visibilitychange", visibility);
        const lost = (event: Event) => {
          event.preventDefault();
          app.stop();
          if (!disposed)
            setError(
              "Графический контекст потерян. Данные задач сохранены. Можно восстановить сцену.",
            );
        };
        const restored = () => {
          if (!disposed) {
            setError("");
            app.start();
          }
        };
        app.canvas.addEventListener("webglcontextlost", lost);
        app.canvas.addEventListener("webglcontextrestored", restored);
        removeContext = () => {
          app.canvas.removeEventListener("webglcontextlost", lost);
          app.canvas.removeEventListener("webglcontextrestored", restored);
        };
        function routeTo(actor: Actor, targetIndex: number) {
          const i = ROLES.indexOf(actor.role);
          actor.route = [
            AISLE[i],
            AISLE[targetIndex],
            {
              x: AISLE[targetIndex].x + (i % 2 === 0 ? -24 : 24),
              y: AISLE[targetIndex].y + 20,
            },
          ].map((p) => ({ ...p }));
          actor.phase = "walking";
          actor.returning = false;
          actor.wait = 0;
        }
        app.ticker.add((ticker) => {
          const begin = performance.now();
          const now = begin;
          const dt = Math.min(ticker.deltaMS, 50) / 1000;
          const options = latest.current;
          app.ticker.maxFPS = reduced ? 15 : options.eco ? 30 : 60;
          actors.forEach((actor, i) => {
            const state = options.agents.find((a) => a.role === actor.role);
            const status = state?.status || "idle";
            if (actor.status !== status) {
              const previous = actor.status;
              actor.status = status;
              if (!reduced) {
                if (status === "failed") {
                  actor.route = [{ ...actor.home }];
                  actor.phase = "walking";
                  actor.returning = true;
                } else if (status === "running" && i === 0) routeTo(actor, 1);
                else if (previous === "running" && status !== "running")
                  routeTo(actor, (i + 1) % 4);
                else if (status === "running") {
                  actor.route = [{ ...actor.home }];
                  actor.phase = "walking";
                  actor.returning = true;
                }
              }
            }
            if (reduced) {
              actor.route = [];
              actor.phase = "seated";
              actor.sprite.position.copyFrom(actor.home);
            }
            if (
              !reduced &&
              actor.phase === "seated" &&
              actor.status === "idle" &&
              now - actor.lastIdle > 45000 + i * 1500
            ) {
              actor.route = [{ ...AISLE[i] }];
              actor.phase = "walking";
              actor.returning = false;
              actor.lastIdle = now;
            }
            let frame = 0;
            let base = 1;
            if (actor.phase === "walking" && actor.route.length) {
              const next = actor.route[0];
              const dx = next.x - actor.sprite.x,
                dy = next.y - actor.sprite.y;
              const dist = Math.hypot(dx, dy);
              const speed = 72;
              const step = Math.min(dist, speed * dt);
              const nx = actor.sprite.x + (dx / (dist || 1)) * step,
                ny = actor.sprite.y + (dy / (dist || 1)) * step;
              const blocked = actors.some(
                (other, j) =>
                  other !== actor &&
                  j < i &&
                  other.phase === "walking" &&
                  Math.hypot(other.sprite.x - nx, other.sprite.y - ny) < 45,
              );
              if (!blocked) {
                actor.sprite.position.set(nx, ny);
                actor.distance += step;
                if (Math.abs(dx) > 1)
                  actor.sprite.scale.x =
                    Math.abs(actor.sprite.scale.x) * (dx < 0 ? -1 : 1);
              }
              base = 0;
              frame = 1 + (Math.floor(actor.distance / 12) % 2);
              if (dist < 2) {
                actor.sprite.position.copyFrom(next);
                actor.route.shift();
                if (!actor.route.length) {
                  if (actor.returning) {
                    actor.phase = "seated";
                    actor.sprite.scale.x = Math.abs(actor.sprite.scale.x);
                  } else {
                    actor.phase = "interaction";
                    actor.wait = actor.status === "idle" ? 0.7 : 1.6;
                  }
                }
              }
            } else if (actor.phase === "interaction") {
              base = 0;
              frame = actor.status === "idle" ? 0 : 3;
              actor.wait -= dt;
              if (actor.wait <= 0) {
                actor.route = [{ ...AISLE[i] }, { ...actor.home }];
                actor.phase = "walking";
                actor.returning = true;
              }
            } else if (actor.status === "running") {
              frame = reduced ? 1 : 1 + (Math.floor(now / 280) % 2);
              if (i === 1 && Math.floor(now / 3000) % 3 === 0) frame = 3;
            } else {
              frame = 0;
              if (!reduced)
                actor.sprite.rotation = Math.sin(now / 2400 + i) * 0.008;
            }
            actor.sprite.texture = atlasFrames[base][i][frame];
            if (!reduced && actor.phase !== "seated")
              actor.sprite.rotation = Math.sin(actor.distance * 0.18) * 0.012;
            actor.sprite.zIndex = actor.sprite.y;
            actor.ring.visible = options.selected === actor.role;
            actor.ring.position.set(actor.sprite.x, actor.sprite.y - 2);
            actor.ring.zIndex = actor.sprite.zIndex - 1;
            // Seated characters are masked by desks; walking characters draw above the furniture layer.
            if (actor.phase !== "seated" && actor.sprite.parent !== world) {
              world.addChild(actor.ring, actor.sprite);
            } else if (
              actor.phase === "seated" &&
              actor.sprite.parent !== actorLayer
            ) {
              actorLayer.addChild(actor.ring, actor.sprite);
            }
          });
          slide.clear();
          if (actors[2].status === "running" && !options.eco) {
            slide.roundRect(0, 0, 23, 12, 2).fill({
              color: Math.floor(now / 2000) % 2 ? 0xb3a4ff : 0x8bd9e9,
              alpha: 0.8,
            });
            slide.rect(3, 7, 4, 4).fill(0x7955c4);
            slide.rect(10, 4, 4, 7).fill(0xa46fde);
          }
          const elapsed = now - lastFrame;
          if (lastFrame && elapsed > 0) samples.push(elapsed);
          lastFrame = now;
          ticks++;
          updateMs += performance.now() - begin;
          if (now - lastReport > 2000) {
            const sorted = samples.slice().sort((a, b) => a - b);
            const avg = samples.length
              ? samples.reduce((a, b) => a + b, 0) / samples.length
              : 0;
            const fps = avg ? 1000 / avg : 0;
            const data = {
              fps: +fps.toFixed(1),
              p95Ms: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(
                2,
              ),
              updateMs: +(updateMs / Math.max(1, ticks)).toFixed(3),
              frames: ticks,
              actors: actors.length,
              textures: 3,
              actorStates: actors.map((a) => ({
                role: a.role,
                phase: a.phase,
                x: Math.round(a.sprite.x),
                y: Math.round(a.sprite.y),
                status: a.status,
              })),
              mode: reduced ? "reduced" : options.eco ? "eco" : "normal",
            };
            target!.dataset.metrics = JSON.stringify(data);
            if (metrics.current)
              metrics.current.textContent = `${data.fps} FPS · ${data.mode} · 4 агента`;
            samples = [];
            updateMs = 0;
            ticks = 0;
            lastReport = now;
          }
        });
        target!.dataset.ready = "true";
        setError("");
        if (!document.hidden) app.start();
      } catch (e) {
        if (!disposed)
          setError(
            "Не удалось запустить WebGL-сцену. Доступная панель агентов остаётся работоспособной. " +
              (e instanceof Error ? e.message : ""),
          );
        cleanup();
      }
    }
    void init();
    return () => {
      disposed = true;
      motion.removeEventListener("change", onMotion);
      cleanup();
    };
  }, [attempt]);
  return (
    <>
      <div
        ref={host}
        className="office-canvas-host"
        data-testid="office-scene"
      />
      {agents.map((a, i) => (
        <button
          key={a.role}
          className={
            "scene-agent-label " +
            a.status +
            (selected === a.role ? " selected" : "")
          }
          style={{ left: LABELS[i].x + "%", top: LABELS[i].y + "%" }}
          onClick={() => onSelect(a.role)}
          aria-label={"Открыть агента " + a.name}
        >
          <span className="label-dot" />
          <span>
            <b>{a.name}</b>
            <small>
              {a.status === "running"
                ? "Выполняет задачу"
                : a.status === "failed"
                  ? "Ошибка · нужна помощь"
                  : "Свободен · ожидание задачи"}
            </small>
          </span>
        </button>
      ))}
      <output
        ref={metrics}
        className="scene-perf"
        aria-label="Производительность сцены"
      >
        Загрузка графического слоя…
      </output>
      {error && (
        <div className="context-error" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Восстановить
          </button>
        </div>
      )}
    </>
  );
}
