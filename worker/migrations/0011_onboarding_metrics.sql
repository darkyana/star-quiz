-- #310: anonymous daily event totals. No raw events, timestamps, IPs, or identities.
-- day is the server-received Asia/Shanghai date; count is occurrences, not people.
CREATE TABLE onboarding_daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  family_status TEXT NOT NULL CHECK (family_status IN ('joined', 'unjoined')),
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, event, family_status)
) WITHOUT ROWID;
