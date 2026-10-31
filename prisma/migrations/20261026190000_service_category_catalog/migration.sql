-- Repair known legacy display labels without deleting custom historical data.
-- Runtime matching uses the same catalog normalization so rollout is safe before
-- this migration reaches every environment. Unknown strings stay unchanged.
BEGIN;

WITH category_aliases(spelling, category) AS (
  VALUES
    ('cleaning', 'cleaning'),
    ('electrical', 'electrical'),
    ('gutter', 'gutter'),
    ('handyman', 'handyman'),
    ('hvac', 'hvac'),
    ('lawn', 'lawn'),
    ('plumbing', 'plumbing'),
    ('roofing', 'roofing'),
    ('other', 'other'),
    ('painting', 'painting'),
    ('pest_control', 'pest_control'),
    ('pool_care', 'pool_care'),
    ('landscaping', 'landscaping'),
    ('seasonal_maintenance', 'seasonal_maintenance'),
    ('lawn_care', 'lawn'),
    ('gutters', 'gutter'),
    ('gutter_cleaning', 'gutter'),
    ('gutter_clearing', 'gutter'),
    ('gardening', 'landscaping'),
    ('pool', 'pool_care'),
    ('pool_cleaning', 'pool_care')
), normalized_profiles AS (
  SELECT profile.id,
    ARRAY(
      SELECT deduplicated.trade
      FROM (
        SELECT COALESCE(alias.category, legacy.trade) AS trade,
          MIN(legacy.position) AS first_position
        FROM unnest(profile.trades) WITH ORDINALITY AS legacy(trade, position)
        LEFT JOIN category_aliases AS alias
          ON alias.spelling = regexp_replace(lower(regexp_replace(legacy.trade, '^[[:space:]]+|[[:space:]]+$', '', 'g')), '[[:space:]-]+', '_', 'g')
        GROUP BY COALESCE(alias.category, legacy.trade)
      ) AS deduplicated
      ORDER BY deduplicated.first_position
    ) AS trades
  FROM "ProviderProfile" AS profile
)
UPDATE "ProviderProfile" AS profile
SET trades = normalized.trades
FROM normalized_profiles AS normalized
WHERE profile.id = normalized.id
  AND profile.trades IS DISTINCT FROM normalized.trades;

-- Historical HOA requests could contain free text such as Gardening or Pool.
-- Canonicalize recognized categories only; unrelated request state is untouched.
WITH category_aliases(spelling, category) AS (
  VALUES
    ('cleaning', 'cleaning'),
    ('electrical', 'electrical'),
    ('gutter', 'gutter'),
    ('handyman', 'handyman'),
    ('hvac', 'hvac'),
    ('lawn', 'lawn'),
    ('plumbing', 'plumbing'),
    ('roofing', 'roofing'),
    ('other', 'other'),
    ('painting', 'painting'),
    ('pest_control', 'pest_control'),
    ('pool_care', 'pool_care'),
    ('landscaping', 'landscaping'),
    ('seasonal_maintenance', 'seasonal_maintenance'),
    ('lawn_care', 'lawn'),
    ('gutters', 'gutter'),
    ('gutter_cleaning', 'gutter'),
    ('gutter_clearing', 'gutter'),
    ('gardening', 'landscaping'),
    ('pool', 'pool_care'),
    ('pool_cleaning', 'pool_care')
)
UPDATE "HoaServiceRequest" AS request
SET category = alias.category
FROM category_aliases AS alias
WHERE alias.spelling = regexp_replace(lower(regexp_replace(request.category, '^[[:space:]]+|[[:space:]]+$', '', 'g')), '[[:space:]-]+', '_', 'g')
  AND request.category IS DISTINCT FROM alias.category;

COMMIT;
