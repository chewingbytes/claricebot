# Get the code
git clone --depth 1 https://github.com/supabase/supabase

# Make your new supabase project directory
mkdir supabase

# Tree should look like this
# .
# ├── supabase
# └── supabase-project

# Copy the compose files over to your project
cp -rf supabase/docker/* supabase

# Copy the fake env vars
cp supabase/docker/.env.example supabase/.env

# Switch to your project directory
cd supabase

# Pull the latest images
docker compose pull