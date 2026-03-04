import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Profile {
  id: string;
  display_name: string;
  avatar_url?: string;
  games_played: number;
  games_won: number;
  total_score: number;
}

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data as Profile);
          setDisplayName(data.display_name);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    setMessage('');
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() })
      .eq('id', user.id);
    setSaving(false);
    setMessage(error ? error.message : 'Saved!');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
        <Link to="/lobbies" className="text-indigo-400 hover:text-indigo-300 text-sm">← Back to Lobbies</Link>
        <button onClick={signOut} className="btn-secondary text-sm">Sign Out</button>
      </header>

      <main className="max-w-lg mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-8">Profile</h1>

        {profile && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-2xl p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Display Name</label>
                <div className="flex gap-3">
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="flex-1 bg-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button onClick={handleSave} disabled={saving} className="btn-primary">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {message && <p className="text-sm text-green-400 mt-1">{message}</p>}
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <p className="text-gray-300">{user?.email}</p>
              </div>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4">Statistics</h2>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-3xl font-bold text-indigo-400">{profile.games_played}</p>
                  <p className="text-sm text-gray-400 mt-1">Games Played</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-400">{profile.games_won}</p>
                  <p className="text-sm text-gray-400 mt-1">Games Won</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-yellow-400">{profile.total_score}</p>
                  <p className="text-sm text-gray-400 mt-1">Total Score</p>
                </div>
              </div>
              {profile.games_played > 0 && (
                <p className="text-center text-sm text-gray-500 mt-4">
                  Win rate: {Math.round((profile.games_won / profile.games_played) * 100)}%
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
