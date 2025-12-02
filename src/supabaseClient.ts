import { createClient } from "@supabase/supabase-js";

// 🔒 Tillfälligt: hårdkodat (vi skippar env-variabler helt)
const supabaseUrl = "https://madcyvhmraszhsplirny.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hZGN5dmhtcmFzemhzcGxpcm55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ2NTcsImV4cCI6MjA4MDI2MDY1N30.vfXFqUpSGUD2avW25aeVOJ-KcWXgW10g6J1RHUZo4Ds";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
