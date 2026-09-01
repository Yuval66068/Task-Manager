-- Additive migration: introduce the 'reward_created' notification type value.
-- Split from the original combined 009 migration so the enum value is committed
-- in its own transaction before it is referenced by any function/trigger.

alter type public.notification_type
add value if not exists 'reward_created';
