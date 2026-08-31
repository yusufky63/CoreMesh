'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type ElementDefinition } from 'cytoscape';
import { Maximize2, Network, Table2 } from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import {
  CoreButton,
  EmptyState,
  ProtocolStrip,
  SectionHeader,
} from '../common';

export function NetworkSurface() {
  const state = useCoreMesh();
  const container = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'map' | 'table'>('map');
  const [windowSize, setWindowSize] = useState('5m');
  const elements = useMemo<ElementDefinition[]>(() => {
    const nodes: ElementDefinition[] = [];
    const edges: ElementDefinition[] = [];
    state.agents.forEach((agent, index) => {
      const identity = state.identities.find(
        (item) => item.id === agent.identityId,
      );
      if (!identity) return;
      nodes.push({
        data: {
          id: agent.id,
          label: agent.name.toUpperCase(),
          kind: 'AGENT',
          glyph: '▦',
          signed: true,
        },
        position: { x: 110, y: 90 + index * 120 },
      });
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
    state.rooms.forEach((room, index) =>
      nodes.push({
        data: {
          id: room.id,
          label: room.name.toUpperCase(),
          kind: 'ROOM',
          glyph: '□',
          private: room.kind.includes('private'),
          ephemeral: room.kind.includes('ephemeral'),
        },
        position: { x: 400, y: 70 + index * 90 },
      }),
    );
    state.workers.forEach((worker, index) => {
      nodes.push({
        data: {
          id: worker.id,
          label: worker.name.toUpperCase(),
          kind: 'WORKER',
          glyph: '▥',
          enabled: worker.enabled,
        },
        position: { x: 680, y: 70 + index * 90 },
      });
      edges.push({
        data: {
          id: `edge_${worker.agentId}_${worker.id}`,
          source: worker.agentId,
          target: worker.id,
          label: 'runs',
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
    state.tasks.forEach((task, index) => {
      nodes.push({
        data: {
          id: task.id,
          label: task.title.toUpperCase(),
          kind: 'TASK',
          glyph: '▭',
        },
        position: { x: 390, y: 430 + index * 90 },
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
              label: 'assigned',
            },
          });
      }
    });
    state.receipts.forEach((receipt, index) => {
      const id = `proof_${receipt.taskId}_${index}`;
      nodes.push({
        data: {
          id,
          label: `PROOF ${receipt.taskId.slice(-4)}`,
          kind: 'PROOF',
          glyph: '◇',
          verified: true,
        },
        position: { x: 680, y: 430 + index * 90 },
      });
      edges.push({
        data: {
          id: `edge_${receipt.taskId}_${id}`,
          source: receipt.taskId,
          target: id,
          label: 'result',
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

  useEffect(() => {
    if (!container.current || mode !== 'map') return;
    const cy = cytoscape({
      container: container.current,
      elements,
      layout: { name: 'preset', fit: true, padding: 40 },
      minZoom: 0.35,
      maxZoom: 2.5,
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
            width: 1,
            'line-color': '#3a3a3a',
            'target-arrow-color': '#3a3a3a',
            'target-arrow-shape': 'none',
            'curve-style': 'taxi',
            'taxi-direction': 'rightward',
            'taxi-turn': '24px',
            label: 'data(label)',
            color: '#676767',
            'font-family': 'Space Mono, monospace',
            'font-size': 7,
            'text-background-color': '#050505',
            'text-background-opacity': 1,
            'text-background-padding': '3px',
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
          selector: ':selected',
          style: {
            'border-color': '#f3f3f3',
            'border-width': 2,
            'line-color': '#f3f3f3',
          },
        },
      ],
    });
    return () => cy.destroy();
  }, [elements, mode]);

  const nodes = elements.filter((element) => !element.data.source);
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
            <CoreButton variant="outline" onClick={() => setMode('map')}>
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
        <i>solid = signed · dashed = unsigned · double border = private</i>
      </div>
      {nodes.length ? (
        mode === 'map' ? (
          <div
            className="cy-map"
            ref={container}
            aria-label="Interactive agent network map"
          />
        ) : (
          <div className="network-table">
            <div className="matrix-head">
              <span>ENTITY</span>
              <span>TYPE</span>
              <span>STATE</span>
              <span>RELATIONS</span>
            </div>
            {nodes.map((node) => (
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
          </div>
        )
      ) : (
        <EmptyState
          title="NO MESH ENTITIES"
          body="Connect an agent or create a task to start protocol cartography."
        />
      )}
    </>
  );
}
