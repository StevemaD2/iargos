import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const { error } = await supabase.rpc("archive_chat_messages");
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
