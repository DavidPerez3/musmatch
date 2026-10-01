# Supabase Migrations

Apply SQL files in this folder in lexicographical order.

Current baseline:
- `20260513_phase0_alignment.sql`

This migration aligns:
- Tables and views used by frontend.
- RPC signatures currently called from client pages.
- RLS policies for profiles, events, participants, friendships, and friend requests.
