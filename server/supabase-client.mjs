import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase] Missing credentials - using fallback');
}

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Helper functions
export async function getUser(email) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function createUser(email, password, name) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('users')
    .insert([{ email, password, name, role: 'user' }])
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getProducts(category = null) {
  if (!supabase) throw new Error('Supabase not configured');
  
  let query = supabase.from('products').select('*');
  
  if (category) {
    query = query.eq('category', category);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createProduct(product) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateProduct(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
  return true;
}

export async function createOrder(userId, items, totalPrice) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('orders')
    .insert([{
      user_id: userId,
      items: JSON.stringify(items),
      total_price: totalPrice,
      status: 'new'
    }])
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getOrders(userId = null, status = null) {
  if (!supabase) throw new Error('Supabase not configured');
  
  let query = supabase.from('orders').select('*');
  
  if (userId) {
    query = query.eq('user_id', userId);
  }
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateOrder(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
