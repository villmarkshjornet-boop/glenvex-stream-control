-- x_post_memory: AI-generated X/Twitter posts with learning and performance tracking
-- Creator Brain tracks which hooks, hashtags and timings drove viewer growth.

create table if not exists x_post_memory (
  id                    uuid        primary key default gen_random_uuid(),
  workspace_id          text        not null,
  stream_id             text,
  game                  text,
  post_text             text        not null,
  hashtags              text[]      not null default '{}',
  variant_label         text,                    -- 'aggressive' | 'drama' | 'community'
  hook_score            int,                     -- 0-100
  urgency_score         int,                     -- 0-100
  relevance_score       int,                     -- 0-100
  expected_viewer_lift  int,                     -- estimated new viewers
  ai_recommendation     text,                    -- why this variant was recommended
  learning_context      text,                    -- summary of past data used in prompt
  stream_elapsed_min    int,
  viewer_count_before   int,
  viewer_count_5min     int,
  viewer_count_10min    int,
  viewer_delta_5min     int,
  viewer_delta_10min    int,
  status                text        not null default 'suggested',
  -- suggested | approved | posted | manual_copy | dismissed
  posted_at             timestamptz,
  perf_5min_at          timestamptz,
  perf_10min_at         timestamptz,
  source                text        not null default 'ai_producer_x_post',
  created_at            timestamptz not null default now()
);

create index if not exists x_post_memory_workspace_created
  on x_post_memory(workspace_id, created_at desc);

create index if not exists x_post_memory_posted_perf
  on x_post_memory(workspace_id, status, posted_at)
  where status = 'posted';
