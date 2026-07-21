# Telegram forum routing and delayed Cloudflare spam classification

## Scope and routing model

- Preserve the existing `tgChatId` delivery as legacy mode. Forum delivery is active only when a forum chat plus both fallback topics are configured and enabled.
- Use one Telegram forum supergroup. Each configured recipient has a normal and spam topic; unknown recipients use separate fallback normal and spam topics.
- Keep the existing blacklist as a hard rejection before the message is saved. The new spam policy never rejects an accepted message: it selects the mailbox folder and Telegram topic.
- Do not change external forwarding. A legacy recipient rule no longer stops the forum classification pipeline.

## D1 state

- `telegram_forum_config`: one forum chat, enabled switch, fallback normal/spam topic IDs.
- `telegram_recipient_route`: lower-cased recipient address with normal/spam topic IDs and enabled switch.
- `cloudflare_email_zone`: recipient domain to Cloudflare Zone ID mapping.
- `email_spam_classification`: pending/classified/provisional state, auth results, Cloudflare decision, score, reasons and timestamps.
- `telegram_delivery`: each delivery, topic and Telegram message ID, including deleted and deletion-failed states for late reclassification.
- `spam_sender_rule`: exact-email/domain allowlist and spam-list entries.
- `email.is_spam`: user-visible mailbox flag; Inbox excludes it and the Spam view is always scoped to the logged-in user's accounts.

## Delayed classification flow

1. Save the incoming message and attachments normally, then add a pending classification when forum mode is active. Do not send Telegram immediately.
2. Schedule a per-email Durable Object Alarm for 20 seconds later. The alarm performs the first targeted GraphQL check without keeping a Worker process asleep; failure to schedule it falls back safely to cron.
3. A Workers Cron Trigger runs every minute. It queries Zone-scoped `emailRoutingAdaptive` data through the Cloudflare GraphQL API and matches normalized Message-IDs. It is both the fallback for the fast check and the reconciler for late events.
4. If an event exists, calculate policy and send exactly one message to the normal or spam topic. Delivery rows prevent duplicate alarm/cron work.
5. If no event appears by five minutes, send to the normal topic and mark it `provisional_normal`.
6. Keep checking provisional mail for 24 hours. A late spam decision sends a new spam-topic message and then removes the old normal-topic message. Telegram cannot move a message across topics; a failed delete is retained as `delete_failed` rather than hiding the inconsistency.

## Global spam policy

After a Cloudflare event, priority is: spam-list, allowlist, enabled `isSpam`, then weighted SPF/DKIM/DMARC score. Defaults are softfail +2, none +2 and fail +4, with a threshold of 5. Before an event exists, soft policy is deliberately not applied: the five-minute fallback is always provisional normal.

## Administration and secrets

- System Settings includes protected CRUD for forum configuration, recipient routes, Zone IDs and sender overrides, a backend topic-test action, and all global score settings.
- Chat/topic IDs, Zone IDs and routing addresses live only in D1; they are not part of `websiteConfig`, Worker TOML files, README examples or test fixtures.
- Create a distinct Cloudflare token limited to **Analytics Read** and place it in GitHub Actions secret `CF_EMAIL_ANALYTICS_TOKEN`. The deployment workflow writes it with `wrangler secret put`; it is never returned by the settings APIs.
- Telegram bot token continues to be masked by the settings API. For clean late correction, make the bot an administrator able to delete its own forum messages.

## Rollout

Deploy the migration with forum mode disabled; add the GitHub secret; configure Zone IDs, topics and a test group in System Settings; test immediate normal/spam, five-minute provisional normal and late-spam relocation; then enable forum mode. Monitor pending/provisional/late-spam delivery and Telegram deletion errors in Workers Logs during the first day.
