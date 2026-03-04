import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PublicMatchState, Card, CardColor } from '@wholet/shared';
import { useAuth } from '../contexts/AuthContext';
import { useGameSocket, MatchSnapshot } from '../hooks/useGameSocket';
import DiscardPile from '../components/match/DiscardPile';
import PlayerHand from '../components/match/PlayerHand';
import OpponentSeat from '../components/match/OpponentSeat';
import ChatPanel from '../components/match/ChatPanel';
import ScoreBoard from '../components/match/ScoreBoard';
import { ColorPicker, ChallengeWdf, SevenSwap } from '../components/match/ActionOverlay';

interface ChatMsg {
  fromUserId: string;
  displayName: string;
  message: string;
  createdAt: string;
}

type Overlay =
  | { type: 'color_picker'; cardId: string }
  | { type: 'seven_swap'; cardId: string };

export default function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [pubState, setPubState] = useState<PublicMatchState | null>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [mySeatId, setMySeatId] = useState<number | null>(null);
  const [presence, setPresence] = useState<{ seatId: number; connected: boolean }[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [endResult, setEndResult] = useState<{ winner: string; finalScores: Record<string, number> } | null>(null);

  const { status, playCard, drawCard, callUno, challengeWdf, sendChat } = useGameSocket({
    matchId: matchId!,
    onSnapshot: useCallback((snap: MatchSnapshot) => {
      setPubState(snap.publicState);
      setMyHand(snap.privateHand);
      setMySeatId(snap.yourSeatId);
    }, []),
    onMatchEnded: useCallback((result) => setEndResult(result), []),
    onChatMessage: useCallback((msg) => setChatMessages(prev => [...prev, msg]), []),
    onPresenceUpdate: useCallback((seats) => setPresence(seats), []),
  });

  if (!pubState) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        {status === 'error' ? 'Connection failed. Retrying…' : 'Connecting to match…'}
      </div>
    );
  }

  const mySeat = pubState.seats.find(s => s.seatId === mySeatId);
  const isMyTurn = mySeatId !== null && pubState.currentTurn === mySeatId;
  const pendingAction = pubState.pendingAction;
  const opponentSeats = pubState.seats.filter(s => s.seatId !== mySeatId);

  const isConnected = (seatId: number) =>
    presence.find(p => p.seatId === seatId)?.connected ?? true;

  const handleCardSelect = (cardId: string) => {
    if (!isMyTurn) return;
    const card = myHand.find(c => c.id === cardId);
    if (!card) return;

    // Wild cards need color selection first
    if (card.color === 'wild') {
      setSelectedCardId(cardId);
      setOverlay({ type: 'color_picker', cardId });
      return;
    }

    // Seven swap (sevenO rule)
    if (card.value === '7' && pubState.rulesetConfig?.houseRules?.sevenO) {
      setSelectedCardId(cardId);
      setOverlay({ type: 'seven_swap', cardId });
      return;
    }

    playCard(cardId);
    setSelectedCardId(null);
  };

  const handleColorPick = (color: CardColor) => {
    if (!overlay || overlay.type !== 'color_picker') return;
    playCard(overlay.cardId, color);
    setOverlay(null);
    setSelectedCardId(null);
  };

  const handleSevenSwap = (targetSeatId: number) => {
    if (!overlay || overlay.type !== 'seven_swap') return;
    playCard(overlay.cardId, undefined, targetSeatId);
    setOverlay(null);
    setSelectedCardId(null);
  };

  const showChallengeWdf =
    pendingAction?.type === 'challenge_wdf' &&
    pendingAction.targetSeatId === mySeatId;

  const actorSeat = pubState.seats.find(s => s.seatId === pendingAction?.actorSeatId);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {status !== 'connected' && (
        <div className="bg-yellow-700 text-yellow-100 text-xs text-center py-1">
          {status === 'connecting' ? 'Reconnecting…' : 'Disconnected — retrying…'}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Main game area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Opponents */}
          <div className="flex items-start justify-center gap-4 p-4 flex-wrap">
            {opponentSeats.map(seat => (
              <OpponentSeat
                key={seat.seatId}
                seat={seat}
                isCurrentTurn={pubState.currentTurn === seat.seatId}
                isConnected={isConnected(seat.seatId)}
              />
            ))}
          </div>

          {/* Center table */}
          <div className="flex-1 flex items-center justify-center">
            <DiscardPile
              topCard={pubState.topCard}
              currentColor={pubState.activeColor}
              drawPileCount={pubState.drawPileCount}
              canDraw={isMyTurn && !pendingAction}
              onDraw={drawCard}
            />
          </div>

          <div className="text-center text-sm text-gray-500 pb-1">
            {pubState.direction === 1 ? '→ Clockwise' : '← Counter-clockwise'}
            {isMyTurn && <span className="ml-3 text-yellow-400 font-semibold">Your turn!</span>}
          </div>

          {/* My hand */}
          <div className="p-4 bg-gray-800/50 border-t border-gray-700">
            {mySeat ? (
              <PlayerHand
                hand={myHand}
                topCard={pubState.topCard}
                activeColor={pubState.activeColor}
                selectedId={selectedCardId}
                onSelect={handleCardSelect}
                canDraw={!pendingAction}
                onDraw={drawCard}
                onCallUno={callUno}
                hasCalledUno={mySeat.calledUno}
                isMyTurn={isMyTurn}
              />
            ) : (
              <p className="text-center text-gray-500 text-sm">Spectating</p>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-64 flex flex-col bg-gray-800 border-l border-gray-700">
          <div className="p-3 border-b border-gray-700">
            <ScoreBoard seats={pubState.seats} scoreTarget={pubState.rulesetConfig?.scoreTarget ?? 500} />
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 pt-3 text-xs font-semibold text-gray-400 uppercase">Chat</div>
            <ChatPanel
              messages={chatMessages.map(m => ({
                userId: m.fromUserId,
                displayName: m.displayName,
                text: m.message,
                ts: new Date(m.createdAt).getTime(),
              }))}
              onSend={sendChat}
              myUserId={user?.id ?? ''}
            />
          </div>
        </div>
      </div>

      {/* Overlays */}
      {overlay?.type === 'color_picker' && (
        <ColorPicker onPick={handleColorPick} />
      )}

      {overlay?.type === 'seven_swap' && (
        <SevenSwap
          seats={opponentSeats}
          onChoose={handleSevenSwap}
        />
      )}

      {showChallengeWdf && (
        <ChallengeWdf
          challengerName={actorSeat?.displayName ?? 'Opponent'}
          onDecide={(challenge) => challengeWdf(challenge ? 'challenge' : 'accept')}
        />
      )}

      {/* Match ended modal */}
      {endResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full text-center">
            <h2 className="text-3xl font-extrabold mb-2">
              {endResult.winner === user?.id ? 'You Win!' : 'Game Over'}
            </h2>
            <p className="text-gray-400 mb-4">
              {endResult.winner === user?.id
                ? 'Congratulations!'
                : `${pubState.seats.find(s => s.userId === endResult.winner)?.displayName ?? 'Someone'} wins!`}
            </p>
            <div className="space-y-1 mb-6">
              {Object.entries(endResult.finalScores).map(([uid, score]) => (
                <div key={uid} className="flex justify-between text-sm">
                  <span>{pubState.seats.find(s => s.userId === uid)?.displayName ?? uid}</span>
                  <span className="text-gray-400">{score} pts</span>
                </div>
              ))}
            </div>
            <button onClick={() => navigate('/lobbies')} className="btn-primary w-full">Back to Lobbies</button>
          </div>
        </div>
      )}
    </div>
  );
}
