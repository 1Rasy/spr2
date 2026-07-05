import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://wyjbnnqhiehjccmojbbg.supabase.co';
const fallbackKey = 'sb_publishable_WwTC7079N2e8ZQwPKUj-Gw_ewFiviFG';

const url = import.meta.env.VITE_SUPABASE_URL || fallbackUrl;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || fallbackKey;

export const supabase = createClient(url, key);
