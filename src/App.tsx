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

  const [deleteMode, setDeleteMode] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPlayerSection, setShowPlayerSection] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  // vilka är närvarande för träningsschemat
  const [presentPlayers, setPresentPlayers] = useState<string[]>([]);

  // genererat träningsschema: lista med matcher
  const [trainingSchedule, setTrainingSchedule] = useState<
    { gameIndex: number; teamA: string[]; teamB: string[]; bench: string[] }[]
  >([]);

  const [playersPerTeam, setPlayersPerTeam] = useState(4); // 4v4 som default

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

    const game = games.find((g) => g.id === selectedGame);
    if (game?.locked) {
      alert("Den här matchen är låst och kan inte ändras.");
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

    // om det redan finns plus/minus: fråga om overwrite
    if (gameStats.length > 0) {
      const anyNonZero = gameStats.some((s) => s.plus_minus !== 0);
      if (anyNonZero) {
        const ok = confirm(
          "Det finns redan plus/minus för den här matchen. Vill du skriva över dem?"
        );
        if (!ok) return;
      }
    }

    // om inga stats: skapa från teamA/teamB
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

    // uppdatera plus/minus i DB
    const updates = gameStats.map((st) => {
      const pm = st.team === winnerTeam ? diff : -diff;
      return { id: st.id, plus_minus: pm };
    });

    for (const u of updates) {
      await supabase.from("stats").update({ plus_minus: u.plus_minus }).eq("id", u.id);
    }

    // spara själva poängen på games (om du använder dessa kolumner)
    const { data: updatedGameRow, error: updateGameError } = await supabase
      .from("games")
      .update({ score_team_a: a, score_team_b: b, locked: true }) // 👈 auto-lås här
      .eq("id", selectedGame)
      .select()
      .single();

    if (updateGameError) {
      console.error(updateGameError);
      alert("Plus/minus uppdaterat, men kunde inte låsa matchen.");
    }

    // hämta om stats från DB → leaderboard uppdateras
    const { data: refreshedStats } = await supabase.from("stats").select("*");
    if (refreshedStats) {
      setStats(refreshedStats as Stat[]);
    }

    // uppdatera games i state så locked & score syns direkt i UI
    if (updatedGameRow) {
      setGames((prev) =>
        prev.map((g) => (g.id === updatedGameRow.id ? (updatedGameRow as Game) : g))
      );
    }

    alert("Plus/minus uppdaterat och matchen är nu låst!");
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

  // Tränings-schemagenerator: 3 matcher, 3v3/4v4/5v5, balance +/− och speltid
  const generateTrainingSchedule = () => {
    const GAMES_COUNT = 3;                       // hur många matcher per träning
    const PLAYERS_PER_TEAM = playersPerTeam;     // 3, 4 eller 5
    const PLAYERS_PER_GAME = PLAYERS_PER_TEAM * 2; // t.ex. 4v4 → 8 spelare

    // ta bara med spelare som är markerade som närvarande
    const pool = leaderboard.filter((row) =>
      presentPlayers.includes(row.player.id)
    );

    if (pool.length < PLAYERS_PER_GAME) {
      alert(
        `Behöver minst ${PLAYERS_PER_GAME} närvarande spelare för ${PLAYERS_PER_TEAM}v${PLAYERS_PER_TEAM} (just nu: ${pool.length}).`
      );
      return;
    }

    // alla börjar med 0 matcher spelade
    const gamesPlayed: Record<string, number> = {};
    for (const row of pool) {
      gamesPlayed[row.player.id] = 0;
    }

    const schedule: {
      gameIndex: number;
      teamA: string[];
      teamB: string[];
      bench: string[];
    }[] = [];

    for (let gameIndex = 0; gameIndex < GAMES_COUNT; gameIndex++) {
      // sortera: först de som spelat minst matcher, sedan högst totalPM
      const sortedPool = [...pool].sort((a, b) => {
        const diffPlayed = gamesPlayed[a.player.id] - gamesPlayed[b.player.id];
        if (diffPlayed !== 0) return diffPlayed;
        return b.totalPM - a.totalPM;
      });

      // välj spelare till denna match
      const participants = sortedPool.slice(0, PLAYERS_PER_GAME);

      // balansera lag A/B både på antal OCH på plus/minus,
      // men med olika "mönster" per game så lagen blandas
      const teamA: string[] = [];
      const teamB: string[] = [];
      let sumA = 0;
      let sumB = 0;
      const TEAM_SIZE = PLAYERS_PER_TEAM;

      const participantsSorted = [...participants].sort(
        (a, b) => b.totalPM - a.totalPM // starkast först
      );

      // mönster säger vilket lag varje rankad spelare "helst" ska hamna i
      // index 0 = bästa spelaren, index 1 = näst bästa osv.
      let pattern: ("A" | "B")[] = [];

      if (gameIndex % 3 === 0) {
        // Game 1: klassisk balans – bästa delas upp
        // 0:A, 1:B, 2:A, 3:B, ...
        pattern = ["A", "B", "A", "B", "A", "B", "A", "B"];
      } else if (gameIndex % 3 === 1) {
        // Game 2: topparna paras mer – 0:A,1:A,2:B,3:B ...
        pattern = ["A", "A", "B", "B", "A", "A", "B", "B"];
      } else {
        // Game 3: blandning – 0:B,1:A,2:A,3:B ...
        pattern = ["B", "A", "A", "B", "B", "A", "A", "B"];
      }

      for (let i = 0; i < participantsSorted.length; i++) {
        const row = participantsSorted[i];
        const pm = row.totalPM;
        const id = row.player.id;

        const preferred = pattern[i] ?? (sumA <= sumB ? "A" : "B");

        const putIn = (team: "A" | "B") => {
          if (team === "A") {
            teamA.push(id);
            sumA += pm;
          } else {
            teamB.push(id);
            sumB += pm;
          }
        };

        if (preferred === "A") {
          if (teamA.length < TEAM_SIZE) {
            putIn("A");
          } else {
            putIn("B");
          }
        } else {
          if (teamB.length < TEAM_SIZE) {
            putIn("B");
          } else {
            putIn("A");
          }
        }
      }

      // bänk = alla närvarande som inte spelar denna match
      const participantIds = new Set(participants.map((p) => p.player.id));
      const bench = pool
        .map((p) => p.player.id)
        .filter((id) => !participantIds.has(id));

      // uppdatera matcher spelade
      for (const p of participants) {
        gamesPlayed[p.player.id] += 1;
      }

      schedule.push({
        gameIndex,
        teamA,
        teamB,
        bench,
      });
    }

    setTrainingSchedule(schedule);
    alert(`Träningsschema genererat för ${GAMES_COUNT} matcher!`);
  };

  const matchHistory = games
    .filter((g) => g.score_team_a != null && g.score_team_b != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // senaste först

  const selectedGameObj = games.find((g) => g.id === selectedGame) || null;

  const handleLogin = () => {
    const name = loginName.trim();
    const pass = loginPassword;

    // hårdkodat admin-konto
    if (name === "admin" && pass === "B123") {
      setIsAdmin(true);
      setShowLogin(false);
      setLoginName("");
      setLoginPassword("");
      alert("Inloggad som admin");
    } else {
      alert("Fel användarnamn eller lösenord");
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
  };

  const handleDeleteGame = async (gameId: string) => {
    if (!isAdmin) return;

    const game = games.find((g) => g.id === gameId);
    const label = game ? `${game.date} — ${game.name}` : "denna match";

    const ok = confirm(
      `Ta bort matchen ${label}? Alla plus/minus för den matchen kommer försvinna.`
    );
    if (!ok) return;

    const { error } = await supabase.from("games").delete().eq("id", gameId);
    if (error) {
      console.error(error);
      alert("Kunde inte ta bort matchen");
      return;
    }

    // uppdatera state lokalt
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setStats((prev) => prev.filter((s) => s.game_id !== gameId));

    if (selectedGame === gameId) {
      setSelectedGame(null);
      setTeamA([]);
      setTeamB([]);
      setScoreA("");
      setScoreB("");
    }

    alert("Matchen togs bort.");
  };

  return (
    <div className="app">
      <h1>Basket Plus/Minus</h1>

      {/* LEADERBOARD – alltid synlig */}
      <section className="card">
        <div className="card-header">
          <h2>Leaderboard (total plus/minus)</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Spelare</th>
              <th>Total +/− (W/L)</th>
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

      {/* =========================
          LAGGENERATOR DROPDOWN
        ========================= */}
      <section className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
          }}
          onClick={() => setShowGenerator(!showGenerator)}
        >
          <h2>Generera Lag</h2>
          <span style={{ fontSize: 13, opacity: 0.8 }}>
            {showGenerator ? "▲ Dölj" : "▼ Visa"}
          </span>
        </div>

        {showGenerator && (
          <>
            <p style={{ fontSize: 13, opacity: 0.8, marginTop: 8, marginBottom: 8 }}>
              Kryssa i vilka som är på plats. Välj 3v3, 4v4 eller 5v5 så genereras tre
              matcher med så jämna lag som möjligt och så jämn speltid som möjligt.
            </p>

            {/* Välj spelform */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 14, marginRight: 8 }}>
                Spelform:
                <select
                  value={playersPerTeam}
                  onChange={(e) => setPlayersPerTeam(Number(e.target.value))}
                  style={{ marginLeft: 6 }}
                >
                  <option value={3}>3v3</option>
                  <option value={4}>4v4</option>
                  <option value={5}>5v5</option>
                </select>
              </label>
            </div>

            {/* Närvarande-spelare */}
            <div style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>Närvarande idag</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {players.map((p) => (
                  <label key={p.id} style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={presentPlayers.includes(p.id)}
                      onChange={() => {
                        if (presentPlayers.includes(p.id)) {
                          setPresentPlayers(presentPlayers.filter((id) => id !== p.id));
                        } else {
                          setPresentPlayers([...presentPlayers, p.id]);
                        }
                      }}
                    />{" "}
                    {p.name}
                  </label>
                ))}
              </div>
            </div>

            <button onClick={generateTrainingSchedule}>
              Generera schema (3 matcher)
            </button>

            {/* Visa genererat schema */}
            {trainingSchedule.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {trainingSchedule.map((g) => (
                  <div
                    key={g.gameIndex}
                    style={{
                      border: "1px solid #4b5563",
                      borderRadius: 8,
                      padding: "8px 10px",
                      background: "#020617",
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Game {g.gameIndex + 1} ({playersPerTeam}v{playersPerTeam})
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>Lag A</div>
                        <ul style={{ paddingLeft: 16, margin: 0 }}>
                          {g.teamA.map((id) => {
                            const p = players.find((x) => x.id === id);
                            return <li key={id}>{p?.name ?? "Okänd"}</li>;
                          })}
                        </ul>
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Lag B</div>
                        <ul style={{ paddingLeft: 16, margin: 0 }}>
                          {g.teamB.map((id) => {
                            const p = players.find((x) => x.id === id);
                            return <li key={id}>{p?.name ?? "Okänd"}</li>;
                          })}
                        </ul>
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Bänk</div>
                        <ul style={{ paddingLeft: 16, margin: 0 }}>
                          {g.bench.length === 0 ? (
                            <li>Ingen</li>
                          ) : (
                            g.bench.map((id) => {
                              const p = players.find((x) => x.id === id);
                              return <li key={id}>{p?.name ?? "Okänd"}</li>;
                            })
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* MATCHHISTORIK – också alltid synlig */}
      <section className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
          }}
          onClick={() => setShowHistory(!showHistory)}
        >
          <h2>Matchhistorik</h2>
          <span style={{ fontSize: 13, opacity: 0.8 }}>
            {showHistory ? "▲ Dölj" : "▼ Visa"}
          </span>
        </div>

        {showHistory && (
          <>
            {matchHistory.length === 0 ? (
              <p style={{ opacity: 0.7, fontSize: 14 }}>Inga matcher med resultat ännu.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {matchHistory.map((g) => {
                  const a = g.score_team_a!;
                  const b = g.score_team_b!;
                  const winner =
                    a === b ? "—" : a > b ? "Lag A" : "Lag B";

                  const playersA = stats
                    .filter((s) => s.game_id === g.id && s.team === "A")
                    .map((s) => players.find((p) => p.id === s.player_id)?.name)
                    .filter(Boolean);

                  const playersB = stats
                    .filter((s) => s.game_id === g.id && s.team === "B")
                    .map((s) => players.find((p) => p.id === s.player_id)?.name)
                    .filter(Boolean);

                  return (
                    <li
                      key={g.id}
                      style={{
                        marginTop: 6,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #4b5563",
                        background: "#020617",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 14,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>
                          {g.date} — {g.name}
                        </div>
                        <div style={{ opacity: 0.8 }}>
                          Resultat: {a} – {b} ({winner})
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          <div><b>Lag A:</b> {playersA.join(", ") || "—"}</div>
                          <div><b>Lag B:</b> {playersB.join(", ") || "—"}</div>
                        </div>
                      </div>

                      {/* Ta bort-knapp för admin */}
                      {isAdmin && (
                        <button
                          style={{ marginLeft: 8, fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteGame(g.id);
                          }}
                        >
                          Ta bort
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      {/* LOGIN / ADMIN-KONTROLLER */}
      {!isAdmin ? (
        <section className="card">
          <button className="btn-primary" onClick={() => setShowLogin(!showLogin)}>
            {showLogin ? "Stäng login" : "Logga in som admin"}
          </button>

          {showLogin && (
            <div style={{ marginTop: 12 }}>
              <input
                type="text"
                placeholder="Användarnamn"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                style={{ display: "block", marginBottom: 8, width: "100%" }}
              />
              <input
                type="password"
                placeholder="Lösenord"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{ display: "block", marginBottom: 8, width: "100%" }}
              />
              <button className="btn-primary" onClick={handleLogin}>Logga in</button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>Admin-läge</h2>
              <button className="btn-ghost" onClick={handleLogout}>Logga ut</button>
            </div>
            <p style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
              Du är inloggad som admin och kan ändra spelare, matcher och resultat.
            </p>
          </section>

          {/* SPELARE */}
          <section className="card">
        <button
          className="btn-ghost"
          onClick={() => setShowPlayerSection(!showPlayerSection)}
          style={{ marginBottom: 8 }}
        >
          {showPlayerSection ? "Dölj lägg till/ta bort spelare" : "Lägg till/ta bort spelare"}
        </button>

        {showPlayerSection && (
          <>
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
            onClick={() => setDeleteMode(!deleteMode)}
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
          </>
        )}
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
        </>
      )}
    </div>
  );
}
