-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
-- A schema-scoped REVOKE cannot override that global default, therefore this
-- rule must be global for the role that owns the application migrations.

begin;

alter default privileges for role postgres
  revoke execute on functions from public;

-- Keep the API roles denied explicitly for both application schemas. These
-- statements are intentionally repeated after migration 003 so the complete
-- future-function policy is visible and idempotent in one place.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from anon, authenticated, service_role;

commit;
