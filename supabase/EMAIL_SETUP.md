# Email Notifications Setup Guide

## Prerequisites

### 1. Create Resend Account
1. Go to [resend.com](https://resend.com)
2. Sign up for free account
3. Verify your email

### 2. Get API Key
1. Go to **API Keys** in Resend dashboard
2. Click **Create API Key**
3. Copy the key (starts with `re_`)

### 3. Verify Domain (Optional but Recommended)
**Option A: Use your domain**
1. Add your domain in Resend
2. Add DNS records (TXT, MX, CNAME)
3. Wait for verification

**Option B: Use test domain**
- Resend provides `onboarding@resend.dev`
- Can only send to your own email
- Good for testing

## Installation Steps

### Step 1: Enable pg_net Extension
In Supabase SQL Editor:
```sql
create extension if not exists pg_net;
```

### Step 2: Update SQL File
1. Open `supabase/email_notifications.sql`
2. Replace `YOUR_RESEND_API_KEY` with your actual API key
3. Update `noreply@musmatch.com` with your domain
4. Update URLs from `https://musmatch.com` to your actual domain

### Step 3: Execute SQL
1. Open Supabase SQL Editor
2. Copy entire contents of `email_notifications.sql`
3. Execute

## Testing

### Test 1: Friend Request
```sql
-- Send friend request (replace UUIDs with real user IDs)
insert into friend_requests (from_user_id, to_user_id, status)
values ('your-user-id', 'friend-user-id', 'PENDING');
```
**Expected**: Email sent to friend

### Test 2: Accept Request
```sql
-- Accept request (replace with real request ID)
update friend_requests
set status = 'ACCEPTED'
where id = 'request-id';
```
**Expected**: Email sent to original sender

### Test 3: Match Invite
Create a match with friend using the app - email should be sent automatically.

### Test 4: Match Result
Post a result in the app - all participants should receive email.

## Troubleshooting

### Emails not sending?
1. Check Supabase logs for errors
2. Verify API key is correct
3. Check Resend dashboard for failed sends
4. Ensure pg_net extension is enabled

### Emails in spam?
1. Verify your domain in Resend
2. Add SPF, DKIM, DMARC records
3. Use verified domain instead of test domain

### Rate limiting?
- Free tier: 3,000 emails/month
- Upgrade if needed

## Customization

### Change Email Templates
Edit the `v_html` variable in each trigger function:
- `notify_friend_request()` - Friend request email
- `notify_friend_accepted()` - Acceptance email
- `notify_match_invite()` - Match invite email
- `notify_match_result()` - Result notification

### Add More Notifications
Create new trigger functions following the same pattern:
1. Create function with trigger logic
2. Build HTML template
3. Call `send_email()`
4. Create trigger on table

## Security Notes

⚠️ **IMPORTANT**: Never commit API keys to git!

**Better approach**: Use Supabase Vault
```sql
-- Store API key in vault
select vault.create_secret('YOUR_API_KEY', 'resend_api_key');

-- Use in function
declare
  v_api_key text;
begin
  v_api_key := vault.read_secret('resend_api_key');
  -- Use v_api_key in http_post
end;
```

## Future Enhancements

- [ ] Add unsubscribe functionality
- [ ] Rate limiting per user
- [ ] Email preferences in profile
- [ ] Batch notifications (digest emails)
- [ ] Email templates in separate files
