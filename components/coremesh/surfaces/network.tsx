'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type ElementDefinition } from 'cytoscape';
import { Maximize2, Network, Table2 } from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import {
  CoreButton,
  EmptyState,
  Pagination,
  ProtocolStrip,
  SectionHeader,
  shortDid,
} from '../common';

export function NetworkSurface() {
  const state = useCoreMesh();
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [mode, setMode] = useState<'map' | 'table'>('map');
  const [windowSize, setWindowSize] = useState('5m');
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    label: string;
    kind: string;
    glyph: string;
    targetView?: string;
    targetId?: string;
    did?: string;
    messageCount?: number;
    enabled?: boolean;
    status?: string;
  } | null>(null);

  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes: ElementDefinition[] = [];
    const edges: ElementDefinition[] = [];

    // 1. AGENTS: Left Cluster
    state.agents.forEach((agent, index) => {
      const identity = state.identities.find(
        (item) => item.id === agent.identityId,
      );
      if (!identity) return;
      const yPos = 100 + index * 140;
      nodes.push({
        data: {
          id: agent.id,
          label: agent.name.toUpperCase(),
          kind: 'AGENT',
          glyph: '▦',
          signed: true,
          did: identity.did,
          targetView: 'agents',
        },
        position: { x: 120, y: yPos },
      });

      // Connect agent to rooms it participates in
      state.rooms
        .filter(
          (room) =>
            state.workers.some(
              (worker) =>
                worker.agentId === agent.id && worker.rooms.includes(room.id),
            ) ||
            state.messages.some(
              (message) =>
                message.from === identity.did && message.roomId === room.id,
            ),
        )
        .forEach((room) =>
          edges.push({
            data: {
              id: `edge_${agent.id}_${room.id}`,
              source: agent.id,
              target: room.id,
              label: 'participates',
              signed: true,
            },
          }),
        );
    });

    // 2. WORKERS: Clustered around controlling Agent
    state.workers.forEach((worker, index) => {
      const parentAgentIdx = state.agents.findIndex(
        (a) => a.id === worker.agentId,
      );
      const agentY =
        parentAgentIdx >= 0 ? 100 + parentAgentIdx * 140 : 100 + index * 100;
      const workerYOffset =
        (index % 2 === 0 ? -40 : 40) + Math.floor(index / 2) * 50;

      nodes.push({
        data: {
          id: worker.id,
          label: worker.name.toUpperCase(),
          kind: 'WORKER',
          glyph: '▥',
          enabled: worker.enabled,
          targetView: 'workers',
        },
        position: { x: 340, y: agentY + workerYOffset },
      });

      edges.push({
        data: {
          id: `edge_${worker.agentId}_${worker.id}`,
          source: worker.agentId,
          target: worker.id,
          label: 'controls',
        },
      });

      worker.rooms.forEach((room) =>
        edges.push({
          data: {
            id: `edge_${worker.id}_${room}`,
            source: worker.id,
            target: room,
            label: 'listens',
            dotted: true,
          },
        }),
      );
    });

    // 3. ROOMS: Central Communication Nexus
    state.rooms.forEach((room, index) => {
      const yPos = 80 + index * 100;
      nodes.push({
        data: {
          id: room.id,
          label: room.name.toUpperCase(),
          kind: 'ROOM',
          glyph: '□',
          private: room.kind.includes('private'),
          ephemeral: room.kind.includes('ephemeral'),
          messageCount: room.messageCount,
          targetView: 'rooms',
        },
        position: { x: 580, y: yPos },
      });
    });

    // 4. TASKS: Right Output Cluster
    state.tasks.forEach((task, index) => {
      const yPos = 100 + index * 110;
      nodes.push({
        data: {
          id: task.id,
          label: task.title.toUpperCase(),
          kind: 'TASK',
          glyph: '▭',
          status: task.status,
          targetView: 'tasks',
        },
        position: { x: 820, y: yPos },
      });

      if (task.assignedAgentDid) {
        const identity = state.identities.find(
          (item) => item.did === task.assignedAgentDid,
        );
        const agent =
          identity &&
          state.agents.find((item) => item.identityId === identity.id);
        if (agent)
          edges.push({
            data: {
              id: `edge_${agent.id}_${task.id}`,
              source: agent.id,
              target: task.id,
              label: 'executes',
            },
          });
      }
    });

    // 5. PROOFS: Output Verifier Terminal Nodes
    state.receipts.forEach((receipt, index) => {
      const id = `proof_${receipt.taskId}_${index}`;
      const parentTaskIdx = state.tasks.findIndex(
        (t) => t.id === receipt.taskId,
      );
      const taskY =
        parentTaskIdx >= 0 ? 100 + parentTaskIdx * 110 : 100 + index * 90;

      nodes.push({
        data: {
          id,
          label: `PROOF ${receipt.taskId.slice(-4)}`,
          kind: 'PROOF',
          glyph: '◇',
          verified: true,
          targetView: 'proofs',
          targetId: receipt.taskId,
        },
        position: { x: 1040, y: taskY },
      });

      edges.push({
        data: {
          id: `edge_${receipt.taskId}_${id}`,
          source: receipt.taskId,
          target: id,
          label: 'attests',
          signed: true,
        },
      });
    });

    return [...nodes, ...edges];
  }, [
    state.agents,
    state.identities,
    state.rooms,
    state.workers,
    state.messages,
    state.tasks,
    state.receipts,
  ]);

  const handleFocus = () => {
    if (mode !== 'map') setMode('map');
    if (!cyRef.current) return;
    if (selectedNode) {
      const ele = cyRef.current.$id(selectedNode.id);
      if (ele && ele.length) {
        cyRef.current.animate({
          center: { eles: ele },
          zoom: 1.3,
          duration: 350,
        });
        return;
      }
    }
    cyRef.current.animate({
      fit: { eles: cyRef.current.elements(), padding: 40 },
      duration: 350,
    });
  };

  useEffect(() => {
    if (!container.current || mode !== 'map') return;
    const cy = cytoscape({
      container: container.current,
      elements,
      layout: { name: 'preset', fit: true, padding: 50 },
      minZoom: 0.25,
      maxZoom: 3.0,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#090909',
            'border-color': '#676767',
            'border-width': 1,
            shape: 'rectangle',
            width: 112,
            height: 42,
            label: 'data(label)',
            color: '#f3f3f3',
            'font-family': 'Space Mono, monospace',
            'font-size': 9,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'ellipsis',
            'text-max-width': '92px',
            'transition-property': 'border-color, border-width, opacity',
            'transition-duration': 0.2,
          },
        },
        {
          selector: 'node[kind="AGENT"]',
          style: { 'border-color': '#00b4d8', 'border-width': 2 },
        },
        {
          selector: 'node[kind="WORKER"]',
          style: { 'border-style': 'dotted', 'border-color': '#00b4d8' },
        },
        {
          selector: 'node[kind="TASK"]',
          style: { width: 132, height: 34, 'border-color': '#0466c8' },
        },
        {
          selector: 'node[kind="PROOF"]',
          style: {
            shape: 'diamond',
            width: 58,
            height: 58,
            'border-color': '#32d74b',
          },
        },
        {
          selector: 'node[private]',
          style: { 'border-width': 3, 'border-color': '#a2a2a2' },
        },
        { selector: 'node[ephemeral]', style: { 'border-style': 'dashed' } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#3a3a3a',
            'target-arrow-color': '#3a3a3a',
            'target-arrow-shape': 'none',
            'curve-style': 'taxi',
            'taxi-direction': 'rightward',
            'taxi-turn': '24px',
            label: 'data(label)',
            color: '#676767',
            'font-family': 'Space Mono, monospace',
            'font-size': 7.5,
            'text-background-color': '#050505',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
            'transition-property': 'line-color, width, opacity',
            'transition-duration': 0.2,
          },
        },
        { selector: 'edge[signed]', style: { 'line-color': '#32d74b' } },
        {
          selector: 'edge[dotted]',
          style: {
            'line-style': 'dotted',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#00b4d8',
          },
        },
        {
          selector: '.highlighted',
          style: {
            'border-color': '#00b4d8',
            'border-width': 2,
            'line-color': '#00b4d8',
            opacity: 1,
            'z-index': 999,
          },
        },
        {
          selector: '.faded',
          style: {
            opacity: 0.25,
          },
        },
        {
          selector: ':selected',
          style: {
            'border-color': '#ffffff',
            'border-width': 2,
            'line-color': '#00b4d8',
          },
        },
      ],
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data();
      setSelectedNode({
        id: node.id(),
        label: String(data.label || ''),
        kind: String(data.kind || ''),
        glyph: String(data.glyph || ''),
        targetView: data.targetView ? String(data.targetView) : undefined,
        targetId: data.targetId ? String(data.targetId) : data.id,
        did: data.did ? String(data.did) : undefined,
        messageCount:
          typeof data.messageCount === 'number' ? data.messageCount : undefined,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
        status: data.status ? String(data.status) : undefined,
      });

      cy.elements().removeClass('highlighted faded');
      node.neighborhood().addClass('highlighted');
      node.addClass('highlighted');
      cy.elements().not(node.neighborhood().add(node)).addClass('faded');
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        cy.elements().removeClass('highlighted faded');
      }
    });

    cyRef.current = cy;
    cy.resize();
    cy.fit(undefined, 50);

    return () => {
      try {
        cy.destroy();
        cyRef.current = null;
      } catch {}
    };
  }, [elements, mode]);

  const nodes = elements.filter((element) => !element.data.source);
  const [tablePage, setTablePage] = useState(1);
  const NODES_PER_PAGE = 8;
  const totalTablePages = Math.ceil(nodes.length / NODES_PER_PAGE);
  const paginatedNodes = nodes.slice(
    (tablePage - 1) * NODES_PER_PAGE,
    tablePage * NODES_PER_PAGE,
  );

  return (
    <>
      <SectionHeader
        index="07"
        title={'MESH/\nMAP'}
        subtitle="Deterministic protocol cartography with explicit provenance and relations."
        action={
          <div className="action-row">
            <div className="segmented compact">
              <button
                className={mode === 'map' ? 'active' : ''}
                onClick={() => setMode('map')}
              >
                <Network size={11} /> MAP
              </button>
              <button
                className={mode === 'table' ? 'active' : ''}
                onClick={() => setMode('table')}
              >
                <Table2 size={11} /> TABLE
              </button>
            </div>
            <CoreButton variant="outline" onClick={handleFocus}>
              <Maximize2 size={12} />
              FOCUS
            </CoreButton>
          </div>
        }
      />
      <ProtocolStrip
        values={[
          ['AGENT', String(state.agents.length), 'plain'],
          ['ROOM', String(state.rooms.length), 'plain'],
          ['WORKER', String(state.workers.length), 'plain'],
          ['TASK', String(state.tasks.length), 'plain'],
          [
            'PROOF',
            String(state.receipts.length),
            state.receipts.length ? 'ok' : 'plain',
          ],
        ]}
      />
      <div className="map-toolbar">
        <span>LIVE FLOW</span>
        {['1m', '5m', '15m'].map((value) => (
          <button
            className={windowSize === value ? 'active' : ''}
            onClick={() => setWindowSize(value)}
            key={value}
          >
            {value}
          </button>
        ))}
        <i>
          solid = signed · dashed = unsigned · double border = private · click
          node to inspect
        </i>
      </div>
      {nodes.length ? (
        <div className="map-container-relative">
          <div
            className="cy-map"
            ref={container}
            style={{ display: mode === 'map' ? 'block' : 'none' }}
            aria-label="Interactive agent network map"
          />

          {/* ── Node Inspector HUD Card ── */}
          {selectedNode && mode === 'map' && (
            <div className="map-node-inspector">
              <div className="node-inspector-head">
                <span className="node-inspector-glyph">
                  {selectedNode.glyph}
                </span>
                <div className="node-inspector-titles">
                  <strong>{selectedNode.label}</strong>
                  <span className="node-kind-tag">{selectedNode.kind}</span>
                </div>
                <button
                  className="inspector-close-btn"
                  onClick={() => {
                    setSelectedNode(null);
                    cyRef.current?.elements().removeClass('highlighted faded');
                  }}
                  aria-label="Close inspector"
                >
                  ✕
                </button>
              </div>
              <div className="node-inspector-body">
                {selectedNode.kind === 'ROOM' && (
                  <p>
                    Technocore Channel · {selectedNode.messageCount ?? 0}{' '}
                    messages recorded.
                  </p>
                )}
                {selectedNode.kind === 'AGENT' && (
                  <p>
                    Autonomous Agent · Bound to DID{' '}
                    {shortDid(selectedNode.did || '')}.
                  </p>
                )}
                {selectedNode.kind === 'WORKER' && (
                  <p>
                    Bounded Worker Engine ·{' '}
                    {selectedNode.enabled ? 'Live and active' : 'Paused'}.
                  </p>
                )}
                {selectedNode.kind === 'TASK' && (
                  <p>
                    Coordination Task · Status: {selectedNode.status || 'open'}.
                  </p>
                )}
                {selectedNode.kind === 'PROOF' && (
                  <p>
                    Cryptographic Work Receipt · SHA-256 + Ed25519 signature
                    verified.
                  </p>
                )}
                <div className="node-inspector-actions">
                  <CoreButton
                    onClick={() => {
                      if (selectedNode.targetView) {
                        state.setView(
                          selectedNode.targetView,
                          selectedNode.targetId,
                        );
                        const path = `/${selectedNode.targetView}`;
                        if (window.location.pathname !== path)
                          window.history.pushState(
                            {
                              view: selectedNode.targetView,
                              selectedId: selectedNode.targetId,
                            },
                            '',
                            path,
                          );
                      }
                    }}
                  >
                    OPEN {selectedNode.kind}
                  </CoreButton>
                  <CoreButton
                    variant="outline"
                    onClick={() => {
                      const ele = cyRef.current?.$id(selectedNode.id);
                      if (ele) {
                        cyRef.current?.animate({
                          center: { eles: ele },
                          zoom: 1.5,
                          duration: 350,
                        });
                      }
                    }}
                  >
                    ZOOM IN
                  </CoreButton>
                </div>
              </div>
            </div>
          )}

          {mode === 'table' && (
            <div className="network-table">
              <div className="matrix-head">
                <span>ENTITY</span>
                <span>TYPE</span>
                <span>STATE</span>
                <span>RELATIONS</span>
              </div>
              {paginatedNodes.map((node) => (
                <div className="matrix-row" key={node.data.id}>
                  <span>
                    {node.data.glyph} {node.data.label}
                  </span>
                  <span>{node.data.kind}</span>
                  <span>
                    {node.data.verified
                      ? 'VERIFIED'
                      : node.data.enabled
                        ? 'LIVE'
                        : 'OBSERVED'}
                  </span>
                  <span>
                    {
                      elements.filter(
                        (edge) =>
                          edge.data.source === node.data.id ||
                          edge.data.target === node.data.id,
                      ).length
                    }
                  </span>
                </div>
              ))}
              <Pagination
                currentPage={tablePage}
                totalPages={totalTablePages}
                totalItems={nodes.length}
                onPageChange={setTablePage}
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          title="NO MESH ENTITIES"
          body="Connect an agent or create a task to start protocol cartography."
        />
      )}
    </>
  );
}
