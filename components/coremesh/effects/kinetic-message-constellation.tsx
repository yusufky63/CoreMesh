'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, MessageSquare, Sparkles } from 'lucide-react';
import type { ProtocolMessage } from '@/lib/domain';
import { nodeGlyph } from '@/lib/crypto';
import { shortDid, formatTime } from '../common';

interface FloatingMessageNode {
  id: string;
  message: ProtocolMessage;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  glyphMatrix: boolean[][];
  color: string;
  isVerified: boolean;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function KineticMessageConstellation({
  messages,
  onReply,
  className = '',
}: {
  messages: ProtocolMessage[];
  onReply?: (msg: ProtocolMessage) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<FloatingMessageNode[]>([]);
  const hoveredNodeRef = useRef<FloatingMessageNode | null>(null);
  const draggedNodeRef = useRef<FloatingMessageNode | null>(null);
  const [selectedMessage, setSelectedMessage] =
    useState<ProtocolMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Initialize or update nodes deterministically when messages change
  useEffect(() => {
    const container = containerRef.current;
    const width = container ? container.offsetWidth : 800;
    const height = container ? container.offsetHeight : 500;

    const existingMap = new Map(nodesRef.current.map((n) => [n.id, n]));

    const newNodes: FloatingMessageNode[] = messages.map((msg, index) => {
      const existing = existingMap.get(msg.id);
      if (existing) {
        existing.message = msg;
        existing.isVerified = Boolean(msg.verified);
        return existing;
      }

      const h = hashString(msg.id + msg.from);
      const angle =
        (index / Math.max(messages.length, 1)) * Math.PI * 2 + (h % 100) / 100;
      const dist =
        80 + (h % Math.max(Math.min(width, height) / 2.5 - 100, 120));

      const cx = width / 2;
      const cy = height / 2;

      const x = Math.max(70, Math.min(width - 70, cx + Math.cos(angle) * dist));
      const y = Math.max(
        70,
        Math.min(height - 70, cy + Math.sin(angle) * dist),
      );

      const speed = 0.25 + (h % 30) / 100;
      const vAngle = ((h % 360) * Math.PI) / 180;

      return {
        id: msg.id,
        message: msg,
        x,
        y,
        vx: Math.cos(vAngle) * speed,
        vy: Math.sin(vAngle) * speed,
        radius: msg.verified ? 18 : 15,
        glyphMatrix: nodeGlyph(msg.from),
        color: msg.verified ? '#32d74b' : '#00b4d8',
        isVerified: Boolean(msg.verified),
      };
    });

    nodesRef.current = newNodes;
  }, [messages]);

  // Main interactive animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = (canvas.width = canvas.offsetWidth);
      const height = (canvas.height = canvas.offsetHeight);

      ctx.clearRect(0, 0, width, height);

      // Cybernetic orbital grid & radar concentric rings
      const cx = width / 2;
      const cy = height / 2;

      ctx.strokeStyle = 'rgba(0, 180, 216, 0.05)';
      ctx.lineWidth = 1;
      for (let r = 80; r < Math.max(width, height); r += 90) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Crosshairs
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
      ctx.stroke();

      const nodes = nodesRef.current;

      // 1. Draw interconnected neural threads
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 180) {
            const alpha = (1 - dist / 180) * 0.25;
            ctx.strokeStyle =
              a.isVerified && b.isVerified
                ? `rgba(50, 215, 75, ${alpha})`
                : `rgba(0, 180, 216, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // 2. Physics update & Node rendering
      nodes.forEach((node) => {
        // Apply velocity if not being dragged
        if (draggedNodeRef.current !== node) {
          node.x += node.vx;
          node.y += node.vy;

          // Boundary bounce with padding for callout text
          if (node.x < 60) {
            node.x = 60;
            node.vx *= -1;
          } else if (node.x > width - 60) {
            node.x = width - 60;
            node.vx *= -1;
          }

          if (node.y < 50) {
            node.y = 50;
            node.vy *= -1;
          } else if (node.y > height - 50) {
            node.y = height - 50;
            node.vy *= -1;
          }
        }

        const isHovered = hoveredNodeRef.current === node;
        const isSelected = selectedMessage?.id === node.id;

        // Glowing outer aura
        ctx.save();
        if (isHovered || isSelected) {
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 16;
        }

        // Outer Orbit Ring
        ctx.strokeStyle =
          isHovered || isSelected ? node.color : 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = isHovered || isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        ctx.stroke();

        // Node Body
        ctx.fillStyle = '#090d16';
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Node Glow Ring
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Render Miniature Deterministic DID Glyph inside node
        const glyphSize = node.glyphMatrix.length;
        if (glyphSize > 0) {
          const pixelSize = (node.radius * 1.2) / glyphSize;
          const startX = node.x - (glyphSize * pixelSize) / 2;
          const startY = node.y - (glyphSize * pixelSize) / 2;

          ctx.fillStyle = node.color;
          node.glyphMatrix.forEach((row, r) => {
            row.forEach((on, c) => {
              if (on) {
                ctx.fillRect(
                  startX + c * pixelSize,
                  startY + r * pixelSize,
                  pixelSize - 0.4,
                  pixelSize - 0.4,
                );
              }
            });
          });
        }
        ctx.restore();

        // 3. Floating Message Callout Tag
        const textSnippet =
          node.message.text.length > 28
            ? `${node.message.text.slice(0, 26)}…`
            : node.message.text;

        const tagText = textSnippet;
        const authorText = shortDid(node.message.from);

        ctx.font = '9px Space Mono, monospace';
        const tagWidth =
          Math.max(
            ctx.measureText(tagText).width,
            ctx.measureText(authorText).width,
          ) + 18;
        const tagHeight = 30;
        const tagX = node.x - tagWidth / 2;
        const tagY = node.y - node.radius - tagHeight - 6;

        // Tag stem connector
        ctx.strokeStyle =
          isHovered || isSelected ? node.color : 'rgba(0, 180, 216, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - node.radius - 4);
        ctx.lineTo(node.x, tagY + tagHeight);
        ctx.stroke();

        // Tag Background
        ctx.fillStyle =
          isHovered || isSelected
            ? 'rgba(9, 13, 22, 0.95)'
            : 'rgba(5, 8, 14, 0.85)';
        ctx.strokeStyle =
          isHovered || isSelected ? node.color : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = isHovered || isSelected ? 1.5 : 1;
        ctx.fillRect(tagX, tagY, tagWidth, tagHeight);
        ctx.strokeRect(tagX, tagY, tagWidth, tagHeight);

        // Tag Author & Verified Indicator
        ctx.fillStyle = node.color;
        ctx.font = '7.5px Space Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(authorText, tagX + 6, tagY + 10);

        if (node.isVerified) {
          ctx.fillStyle = '#32d74b';
          ctx.fillText('✓', tagX + tagWidth - 10, tagY + 10);
        }

        // Tag Message Text
        ctx.fillStyle = '#f0f0f0';
        ctx.font = '8.5px Space Mono, monospace';
        ctx.fillText(tagText, tagX + 6, tagY + 23);
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [selectedMessage]);

  // Mouse interactivity handlers (Hover, Drag, Click)
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = mx;
      draggedNodeRef.current.y = my;
      return;
    }

    let found: FloatingMessageNode | null = null;
    for (const node of nodesRef.current) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 14) {
        found = node;
        break;
      }
    }

    hoveredNodeRef.current = found;
    canvas.style.cursor = found ? 'pointer' : 'crosshair';
  };

  const handleMouseDown = () => {
    if (hoveredNodeRef.current) {
      draggedNodeRef.current = hoveredNodeRef.current;
      setSelectedMessage(hoveredNodeRef.current.message);
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
  };

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className={`kinetic-constellation-root ${className}`}
      ref={containerRef}
    >
      <div className="constellation-header-hud">
        <div className="hud-left">
          <Sparkles size={13} className="cyan" />
          <span>KINETIC ORBITAL CONSTELLATION STREAM</span>
          <code>{messages.length} NODES IN ORBIT</code>
        </div>
        <div className="hud-right">
          <small>DRAG NODES · CLICK TO INSPECT · HOVER FOR SPECTRUM</small>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="kinetic-canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          hoveredNodeRef.current = null;
          draggedNodeRef.current = null;
        }}
      />

      {/* ── Floating Inspector HUD Card for Selected Node ── */}
      {selectedMessage && (
        <div className="constellation-inspector-card">
          <div className="inspector-card-head">
            <div className="inspector-card-author">
              <div className="node-glyph-micro">
                <span
                  className={
                    selectedMessage.verified ? 'green-dot' : 'cyan-dot'
                  }
                />
              </div>
              <div>
                <strong>{shortDid(selectedMessage.from)}</strong>
                <span>
                  {selectedMessage.verified ? 'ED25519 VERIFIED' : 'UNVERIFIED'}{' '}
                  · {formatTime(selectedMessage.createdAt)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={() => setSelectedMessage(null)}
              aria-label="Close message inspector"
            >
              ✕
            </button>
          </div>

          <div className="inspector-card-body">
            <p className="inspector-message-text">{selectedMessage.text}</p>
            <div className="inspector-meta-row">
              <code>SEQ {selectedMessage.seq}</code>
              <code>NONCE {selectedMessage.nonce.slice(0, 16)}</code>
            </div>
          </div>

          <div className="inspector-card-actions">
            {onReply && (
              <button
                type="button"
                className="inspector-action-btn primary"
                onClick={() => onReply(selectedMessage)}
              >
                <MessageSquare size={11} />
                <span>REPLY IN ROOM</span>
              </button>
            )}
            <button
              type="button"
              className="inspector-action-btn"
              onClick={() =>
                handleCopy(selectedMessage.text, selectedMessage.id)
              }
            >
              <Copy size={11} />
              <span>
                {copiedId === selectedMessage.id ? 'COPIED' : 'COPY TEXT'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
