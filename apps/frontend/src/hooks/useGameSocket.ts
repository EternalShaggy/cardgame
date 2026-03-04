import { useEffect, useRef, useCallback, useState } from 'react';
import {
  ClientMessage,
  ServerMessage,
  PublicMatchState,
  Card,
} from '@wholet/shared';
import { getWsTicket } from '../lib/api';

const WS_BASE = (import.meta.env.VITE_GAME_SERVICE_URL as string ?? 'http://localhost:3001')
  .replace(/^http/, 'ws');

export type SocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

let _actionCounter = 0;
function nextActionId() {
  return `c-${++_actionCounter}-${Date.now()}`;
}

export interface MatchSnapshot {
  matchId: string;
  version: number;
  yourSeatId: number | null;
  publicState: PublicMatchState;
  privateHand: Card[];
  reconnected?: boolean;
}

interface UseGameSocketOptions {
  matchId: string;
  onSnapshot?: (snapshot: MatchSnapshot) => void;
  onMatchEnded?: (result: { winner: string; finalScores: Record<string, number> }) => void;
  onError?: (code: string, message: string) => void;
  onChatMessage?: (msg: { fromUserId: string; displayName: string; message: string; createdAt: string }) => void;
  onPresenceUpdate?: (seats: { seatId: number; connected: boolean }[]) => void;
  onReconnectionStatus?: (status: { disconnectedSeatId: number; phase: string; secondsElapsed: number }) => void;
}

export function useGameSocket(opts: UseGameSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const matchIdRef = useRef(opts.matchId);
  const [status, setStatus] = useState<SocketStatus>('disconnected');

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setStatus('connecting');

    let ticket: string;
    try {
      ticket = await getWsTicket();
    } catch {
      setStatus('error');
      return;
    }

    const url = `${WS_BASE}/ws?ticket=${ticket}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setStatus('connected');
      send({ type: 'match.join', matchId: matchIdRef.current });
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'match.snapshot':
          opts.onSnapshot?.({
            matchId: msg.matchId,
            version: msg.version,
            yourSeatId: msg.yourSeatId,
            publicState: msg.publicState,
            privateHand: msg.privateHand ?? [],
            reconnected: msg.reconnected,
          });
          break;
        case 'match.ended':
          opts.onMatchEnded?.({ winner: msg.winner, finalScores: msg.finalScores });
          break;
        case 'match.error':
          opts.onError?.(msg.code, msg.message);
          break;
        case 'redirect':
          // Host redirect — reload connection to new host
          break;
        case 'chat.message':
          opts.onChatMessage?.({
            fromUserId: msg.fromUserId,
            displayName: msg.displayName,
            message: msg.message,
            createdAt: msg.createdAt,
          });
          break;
        case 'presence.update':
          opts.onPresenceUpdate?.(msg.seats);
          break;
        case 'reconnection.status':
          opts.onReconnectionStatus?.({
            disconnectedSeatId: msg.disconnectedSeatId,
            phase: msg.phase,
            secondsElapsed: msg.secondsElapsed,
          });
          break;
      }
    };

    ws.onerror = () => setStatus('error');

    ws.onclose = () => {
      setStatus('disconnected');
      const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
      reconnectAttempts.current++;
      reconnectTimer.current = setTimeout(() => connect(), delay);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    matchIdRef.current = opts.matchId;
  }, [opts.matchId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const playCard = useCallback((cardId: string, chosenColor?: string, targetSeatId?: number) => {
    send({
      type: 'action.play_card',
      clientActionId: nextActionId(),
      matchId: matchIdRef.current,
      cardId,
      chosenColor: chosenColor as never,
      targetSeatId,
    });
  }, [send]);

  const drawCard = useCallback(() => {
    send({ type: 'action.draw', clientActionId: nextActionId(), matchId: matchIdRef.current });
  }, [send]);

  const callUno = useCallback(() => {
    send({ type: 'action.call_uno', clientActionId: nextActionId(), matchId: matchIdRef.current });
  }, [send]);

  const challengeWdf = useCallback((decision: 'challenge' | 'accept') => {
    send({ type: 'action.challenge_wdf', clientActionId: nextActionId(), matchId: matchIdRef.current, decision });
  }, [send]);

  const jumpIn = useCallback((cardId: string) => {
    send({ type: 'action.jump_in', clientActionId: nextActionId(), matchId: matchIdRef.current, cardId });
  }, [send]);

  const sendChat = useCallback((message: string) => {
    send({ type: 'chat.send', matchId: matchIdRef.current, message });
  }, [send]);

  const requestSnapshot = useCallback(() => {
    send({ type: 'match.request_snapshot', matchId: matchIdRef.current, reason: 'client_request' });
  }, [send]);

  return {
    status,
    playCard,
    drawCard,
    callUno,
    challengeWdf,
    jumpIn,
    sendChat,
    requestSnapshot,
  };
}
