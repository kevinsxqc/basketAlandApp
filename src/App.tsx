import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

type Player = {
  id: string;
  name: string;
  number: number | null;
};

type Game = {
  id: string;
  date: string;
  name: string | null;
  score_team_a: number | null;
  score_team_b: number | null;
  locked: boolean | null; // 👈 ny
};

type Stat = {
  id: string;
  game_id: string;
  player_id: string;
  team: "A" | "B";
  plus_minus: number;
};

export default function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);

  const [newPlayerName, setNewPlayerName] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [matchName, setMatchName] = useState("");

  const [teamA, setTeamA] = useState<string[]>([]);
  const [teamB, setTeamB] = useState<string[]>([]);

  const [scoreA, setScoreA] = useState<string>("");
  const [scoreB, setScoreB] = useState<string>("");

  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [historyGameId, setHistoryGameId] = useState<string | null>(null);

  const [deleteMode, setDeleteMode] = useState(false);

  useEffect(() => {
    const loadAll = async () => {
      const { data: p } = await supabase.from("players").select("*").order("name");
      const { data: g } = await supabase
        .from("games")
        .select("*")
        .order("date", { ascending: false });
      const { data: s } = await supabase.from("stats").select("*");

      setPlayers(p || []);
      setGames(g || []);
      setStats(s || []);
    };

    loadAll();
  }, []);

  // SKAPA MATCH (datum + matchnamn)
  const createMatch = async () => {
    if (!matchDate) return alert("Välj datum");
    if (!matchName.trim()) return alert("Skriv ett matchnamn (t.ex. Game 1)");

    const { data, error } = await supabase
      .from("games")
      .insert({
        date: matchDate,
        name: matchName.trim(),
        score_team_a: null,
        score_team_b: null,
      })
      .select()
      .single();

    if (error) {
      console.error("createMatch error:", error);
      return alert("Kunde inte skapa match: " + error.message);
    }

    setGames((prev) => [data as Game, ...prev]);
    setSelectedGame(data.id);
    setMatchDate("");
    setMatchName("");
    setScoreA("");
    setScoreB("");
  };

  // SPARA LAG (team A/B → stats-rader)
  const saveTeams = async () => {
    if (!selectedGame) return alert("Ingen match vald");

    await supabase.from("stats").delete().eq("game_id", selectedGame);

    const rows = [
      ...teamA.map((playerId) => ({
        game_id: selectedGame,
        player_id: playerId,
        team: "A" as const,
        plus_minus: 0,
      })),
      ...teamB.map((playerId) => ({
        game_id: selectedGame,
        player_id: playerId,
        team: "B" as const,
        plus_minus: 0,
      })),
    ];

    const { data, error } = await supabase.from("stats").insert(rows).select();

    if (error) {
      console.error(error);
      return alert("Kunde inte spara lagindelning");
    }

    setStats((prev) => [...prev.filter((s) => s.game_id !== selectedGame), ...(data as Stat[])]);
    alert("Lag sparade!");
  };

  // BERÄKNA PLUS/MINUS & SPARA RESULTAT
  const finalizeGame = async () => {
    if (!selectedGame) return alert("Ingen match vald");

    // 🔒 Kolla om matchen är låst
    const game = games.find((g) => g.id === selectedGame);
    if (game?.locked) {
      alert("Den här matchen är låst och kan inte ändras. Lås upp matchen först om du vill ändra resultat.");
      return;
    }

    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);

    if (Number.isNaN(a) || Number.isNaN(b)) {
      return alert("Skriv in poäng för båda lagen.");
    }
    if (a === b) {
      return alert("Matchen kan inte sluta lika om du ska ha plus/minus.");
    }

    const diff = Math.abs(a - b);
    const winnerTeam: "A" | "B" = a > b ? "A" : "B";

    let gameStats = stats.filter((s) => s.game_id === selectedGame);

    // ⚠️ Om det redan finns plus/minus för denna match: fråga om vi ska skriva över
    if (gameStats.length > 0) {
      const anyNonZero = gameStats.some((s) => s.plus_minus !== 0);
      if (anyNonZero) {
        const ok = confirm(
          "Det finns redan plus/minus för den här matchen. Vill du skriva över dem med det nya resultatet?"
        );
        if (!ok) return;
      }
    }

    if (gameStats.length === 0) {
      if (teamA.length + teamB.length === 0) {
        return alert("Välj lag A och lag B först.");
      }

      const rowsToInsert = [
        ...teamA.map((playerId) => ({
          game_id: selectedGame,
          player_id: playerId,
          team: "A" as const,
          plus_minus: 0,
        })),
        ...teamB.map((playerId) => ({
          game_id: selectedGame,
          player_id: playerId,
          team: "B" as const,
          plus_minus: 0,
        })),
      ];

      const { data, error } = await supabase
        .from("stats")
        .insert(rowsToInsert)
        .select();

      if (error || !data) {
        console.error(error);
        return alert("Kunde inte skapa stats för matchen");
      }

      gameStats = data as Stat[];
      setStats((prev) => [...prev, ...gameStats]);
    }

    // uppdatera plus/minus för stats-raderna (denna match)
    const updates = gameStats.map((st) => {
      const pm = st.team === winnerTeam ? diff : -diff;
      return { id: st.id, plus_minus: pm };
    });

    for (const u of updates) {
      await supabase.from("stats").update({ plus_minus: u.plus_minus }).eq("id", u.id);
    }

    // spara resultatet på game också
    const { data: updatedGame, error: gameUpdateError } = await supabase
      .from("games")
      .update({ score_team_a: a, score_team_b: b })
      .eq("id", selectedGame)
      .select()
      .single();

    if (gameUpdateError) {
      console.error(gameUpdateError);
    } else if (updatedGame) {
      setGames((prev) =>
        prev.map((g) => (g.id === updatedGame.id ? (updatedGame as Game) : g))
      );
    }

    // hämta alla stats igen → leaderboard uppdateras
    const { data: refreshed } = await supabase.from("stats").select("*");
    if (refreshed) {
      setStats(refreshed as Stat[]);
    }

    alert("Plus/minus uppdaterat!");
  };

  // LEADERBOARD
  const leaderboard = players
    .map((p) => {
      const playerStats = stats.filter((s) => s.player_id === p.id);

      let wins = 0;
      let losses = 0;
      let totalPM = 0;

      for (const st of playerStats) {
        totalPM += st.plus_minus;

        const game = games.find((g) => g.id === st.game_id);
        if (!game || game.score_team_a == null || game.score_team_b == null) continue;

        const winnerTeam = game.score_team_a > game.score_team_b ? "A" : "B";

        if (st.team === winnerTeam) wins++;
        else losses++;
      }

      return {
        player: p,
        totalPM,
        wins,
        losses,
      };
    })
    .sort((a, b) => b.totalPM - a.totalPM);

  const selectedGameObj = games.find((g) => g.id === selectedGame) || null;
  const historyGame = games.find((g) => g.id === historyGameId) || null;

  const historyStatsA =
    historyGameId == null
      ? []
      : stats.filter((s) => s.game_id === historyGameId && s.team === "A");
  const historyStatsB =
    historyGameId == null
      ? []
      : stats.filter((s) => s.game_id === historyGameId && s.team === "B");

  const playerNameById = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "(okänd spelare)";

  return (
    <div className="app">
      <h1>Basket Plus/Minus</h1>

      {/* SPELARE */}
      <section className="card">
        <div className="card-header">
          <h2>Spelare</h2>
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Namn på spelare"
            value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={async () => {
              const name = newPlayerName.trim();
              if (!name) return;

              const { data, error } = await supabase
                .from("players")
                .insert({ name })
                .select()
                .single();

              if (error) {
                console.error(error);
                alert("Kunde inte lägga till spelare");
                return;
              }

              setPlayers((prev) => [...prev, data as Player]);
              setNewPlayerName("");
            }}
          >
            Lägg till
          </button>

          <button
            className="btn-ghost"
            onClick={() => setDeleteMode((v) => !v)}
          >
            {deleteMode ? "Avsluta ta bort-läge" : "Ta bort spelare"}
          </button>
        </div>

        <ul className="player-list">
          {players.map((p) => (
            <li
              key={p.id}
              style={{ display: "flex", justifyContent: "space-between", maxWidth: 300 }}
            >
              <span>{p.name}</span>
              {deleteMode && (
                <button
                  style={{ fontSize: 12 }}
                  onClick={async () => {
                    if (!confirm(`Ta bort ${p.name}?`)) return;

                    const { error } = await supabase.from("players").delete().eq("id", p.id);
                    if (error) {
                      console.error(error);
                      alert("Kunde inte ta bort spelare");
                      return;
                    }

                    setPlayers((prev) => prev.filter((x) => x.id !== p.id));
                    setStats((prev) => prev.filter((s) => s.player_id !== p.id));
                  }}
                >
                  Ta bort
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* SKAPA MATCH */}
      <section className="card">
        <div className="card-header">
          <h2>Skapa match</h2>
        </div>
        <div className="row">
          <input
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
          />
          <input
            type="text"
            placeholder="Matchnamn (t.ex. Game 1)"
            value={matchName}
            onChange={(e) => setMatchName(e.target.value)}
          />
          <button className="btn-primary" onClick={createMatch}>Skapa</button>
        </div>
      </section>

      {/* VÄLJ MATCH */}
      <section className="card">
        <div className="card-header">
          <h2>Välj match</h2>
        </div>
        <select
          value={selectedGame || ""}
          onChange={(e) => {
            const id = e.target.value || null;
            setSelectedGame(id);
            setTeamA([]);
            setTeamB([]);

            const g = games.find((x) => x.id === id);
            setScoreA(g?.score_team_a != null ? String(g.score_team_a) : "");
            setScoreB(g?.score_team_b != null ? String(g.score_team_b) : "");
          }}
        >
          <option value="">-- välj match --</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.date} — {g.name}
            </option>
          ))}
        </select>

        {selectedGameObj && (
          <div style={{ marginTop: 4, fontSize: 14 }}>
            {selectedGameObj.score_team_a != null &&
            selectedGameObj.score_team_b != null
              ? `Sparat resultat: ${selectedGameObj.score_team_a} - ${selectedGameObj.score_team_b}`
              : "Inget resultat sparat ännu"}
          </div>
        )}

        {selectedGameObj && (
          <div style={{ marginTop: 8 }}>
            <span>
              Status: {selectedGameObj.locked ? "🔒 Låst" : "🔓 Öppen för ändringar"}
            </span>
            <button
              style={{ marginLeft: 8 }}
              onClick={async () => {
                const newLocked = !selectedGameObj.locked;
                if (newLocked) {
                  const ok = confirm(
                    "Är du säker på att du vill låsa matchen? Då kan inte lag eller resultat ändras förrän du låser upp den igen."
                  );
                  if (!ok) return;
                }

                const { data, error } = await supabase
                  .from("games")
                  .update({ locked: newLocked })
                  .eq("id", selectedGameObj.id)
                  .select()
                  .single();

                if (error) {
                  console.error(error);
                  alert("Kunde inte uppdatera lås-status");
                  return;
                }

                setGames((prev) =>
                  prev.map((g) => (g.id === data.id ? (data as Game) : g))
                );
              }}
            >
              {selectedGameObj.locked ? "Lås upp match" : "Lås match"}
            </button>
          </div>
        )}
      </section>

      {selectedGame && (
        <>
          {/* LAGVAL */}
          <section className="card">
            <div className="card-header">
              <h2>Lagindelning</h2>
            </div>
            <div className="teams">
              <div>
                <h3>Lag A</h3>
                {players.map((p) => (
                <div key={p.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={teamA.includes(p.id)}
                      disabled={selectedGameObj?.locked ?? false}
                      onChange={() => {
                        if (teamA.includes(p.id)) {
                          setTeamA(teamA.filter((id) => id !== p.id));
                        } else {
                          setTeamA([...teamA, p.id]);
                          setTeamB(teamB.filter((id) => id !== p.id));
                        }
                      }}
                    />{" "}
                    {p.name}
                  </label>
                </div>
              ))}
            </div>

            <div>
              <h3>Lag B</h3>
              {players.map((p) => (
                <div key={p.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={teamB.includes(p.id)}
                      disabled={selectedGameObj?.locked ?? false}
                      onChange={() => {
                        if (teamB.includes(p.id)) {
                          setTeamB(teamB.filter((id) => id !== p.id));
                        } else {
                          setTeamB([...teamB, p.id]);
                          setTeamA(teamA.filter((id) => id !== p.id));
                        }
                      }}
                    />{" "}
                    {p.name}
                  </label>
                </div>
              ))}
            </div>
          </div>
          </section>

          <button className="btn-primary" style={{ marginTop: 8 }} onClick={saveTeams} disabled={selectedGameObj?.locked ?? false}>
            Spara lag
          </button>

          {/* RESULTAT */}
          <section className="card">
            <div className="card-header">
              <h2>Resultat</h2>
            </div>
            <div>
              <b>Lag A:</b>{" "}
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                disabled={selectedGameObj?.locked ?? false}
              />
            </div>
            <div>
              <b>Lag B:</b>{" "}
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                disabled={selectedGameObj?.locked ?? false}
              />
            </div>
            <button className="btn-primary" style={{ marginTop: 8 }} onClick={finalizeGame} disabled={selectedGameObj?.locked ?? false}>
              Beräkna +/− (sparar resultat)
            </button>
          </section>
        </>
      )}

      {/* LEADERBOARD */}
      <section className="card">
        <div className="card-header">
          <h2>Leaderboard (total plus/minus)</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Spelare</th>
              <th>Total +/−</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row) => (
              <tr key={row.player.id}>
                <td>{row.player.name}</td>
                <td>
                  {row.totalPM >= 0 ? "+" : ""}
                  {row.totalPM}
                  {"  "}
                  <span style={{ opacity: 0.7, marginLeft: 4 }}>
                    ({row.wins}/{row.losses})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* MATCHHISTORIK */}
      <section className="card">
        <div className="card-header">
          <h2>Matchhistorik</h2>
        </div>
        <div className="row">
          {games.map((g) => (
            <button
              key={g.id}
              onClick={() => setHistoryGameId(g.id)}
              style={{
                padding: "4px 8px",
                border: historyGameId === g.id ? "2px solid black" : "1px solid #ccc",
                borderRadius: 4,
                background: "#f9f9f9",
              }}
            >
              {g.date} — {g.name}
            </button>
          ))}
        </div>

        {historyGame && (
          <div style={{ marginTop: 12 }}>
            <h3>
              {historyGame.date} — {historyGame.name}
            </h3>
            <p>
              Resultat:{" "}
              {historyGame.score_team_a != null && historyGame.score_team_b != null
                ? `${historyGame.score_team_a} - ${historyGame.score_team_b}`
                : "Inget resultat sparat"}
            </p>

            <div style={{ display: "flex", gap: 40 }}>
              <div>
                <h4>Lag A</h4>
                <ul>
                  {historyStatsA.map((s) => (
                    <li key={s.id}>{playerNameById(s.player_id)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Lag B</h4>
                <ul>
                  {historyStatsB.map((s) => (
                    <li key={s.id}>{playerNameById(s.player_id)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
