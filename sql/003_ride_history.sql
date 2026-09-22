-- Ride history. A finished ride's numbers are frozen onto the row when it
-- ends, rather than recomputed from its breadcrumb trail on every read: the
-- trail is large, it is the obvious thing to prune one day, and a ride that
-- has ended can never change.

alter table rides add column if not exists distance_km double precision;
alter table rides add column if not exists duration_seconds integer;
alter table rides add column if not exists rider_count integer;

-- Rides that ended before this migration still have their tracks, so their
-- summaries can be worked out now, once.
update rides set
  distance_km = round(ride_distance_km(id)::numeric, 2)::float,
  duration_seconds = extract(epoch from ended_at - started_at)::int,
  rider_count = (
    select count(*)::int from ride_participants p where p.ride_id = rides.id
  )
where ended_at is not null and distance_km is null;

-- The history list is "this group's rides, newest first".
create index if not exists rides_group_started_idx on rides (group_id, started_at desc);
