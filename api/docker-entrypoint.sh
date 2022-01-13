#!/bin/bash
set -e
WAIT_THRESHOLD="${WAIT_THRESHOLD:-20}"
SLEEP_SECONDS="${SLEEP_SECONDS:-3}"

info()
{
    echo "Info: $*"
}

warn()
{
    echo "Warning: $*"
}

fatal()
{
    echo "Fatal: $*"
}

get_couchdb_url()
{
  echo "http://$COUCHDB_USER:$COUCHDB_PASSWORD@$COUCHDB_SERVICE_NAME:$COUCHDB_PORT"
}

wait_for_couchdb()
{
  local  wait_count=0
  while [ "$WAIT_THRESHOLD" -gt $wait_count ]; do
    wait_count=$((wait_count +1))
    curl "`get_couchdb_url`" &>/dev/null
    [ "$?" -eq 0 ] && return 0
    sleep $SLEEP_SECONDS
  done

  return 1
}

is_setup_needed()
{
  ! is_existing_user 'medic-api'
}

is_existing_user()
{
  local user="$1"
  local url="`get_couchdb_url`"
  local id="org.couchdb.user:$user"
  shift 1

  local userdoc=$(curl -X GET $url/_users/$id | jq '._id?')

  if [ "$userdoc" = \"org.couchdb.user:$user\" ]; then
    if [ ! -f /srv/storage/$user/passwd/$user ]; then
      create_couchdb_admin "$user"
      return 1
    fi
    return 0
  else
    return 1
  fi
}

create_couchdb_put()
{
  local should_auth="$1"
  local payload="$2"
  local payload_is_file="$3"

  local cmd='cat'

  if [ -z "$payload_is_file" ]; then
    cmd='echo'
  fi

  if [ "$#" -gt 1 ]; then
    echo -n 'data = "\"' &&
    "$cmd" "$payload" &&
    echo '\""'
  fi
}

create_couchdb_admin()
{
  local user="$1"
  local url="`get_couchdb_url`"

  # generate password and create user
  local passwd=$(< /dev/urandom tr -dc _A-Z-a-z-0-9 | head -c${4:-32};)
  curl -X PUT $url/_node/couchdb@$COUCH_NODE_NAME/_config/admins/$user -d '"'"$passwd"'"'
  mkdir -p /srv/storage/$user/passwd
  echo "$passwd" > /srv/storage/$user/passwd/$user

  # Create user document for administrator
  local id="org.couchdb.user:$user" &&
  \
  local doc="{
    \"id\": \"$id\", \"roles\": [],
    \"type\": \"user\", \"name\": \"$user\"
  }" &&
  \
  create_couchdb_put 't' \
    | curl -K- -sfX PUT -H 'Content-Type: application/json' \
        --data-binary "$doc" "$url/_users/$id" >/dev/null

  if [ ${PIPESTATUS[1]} -ne 0 ]; then
    return 126
  fi

  return 0
}

perform_couchdb_lockdown()
{
  local url="`get_couchdb_url`"
  curl -X PUT $url/_node/couchdb@$COUCH_NODE_NAME/_config/chttpd/require_valid_user -d '"true"'
}

create_system_databases()
{
  local url="`get_couchdb_url`" &&
  for db in _users _replicator _global_changes; do
    if ! curl -sfX PUT "$url/$db" >/dev/null; then
      warn "Failed to created system database '$db'"
      return "$?"
    fi
  done
}

postinstall()
{
  info 'Creating system databases' &&
  create_system_databases \
    || fatal 'Failed to create one or more system databases'

  info 'Restricting CouchDB to authorized users only' &&
  perform_couchdb_lockdown

  if [ "$?" -ne 0 ]; then
    fatal "Failed to lock out invalid CouchDB users"
  fi

  info 'Creating CouchDB service accounts'

  create_couchdb_admin 'medic-api'

  if [ "$?" -ne 0 ]; then
    fatal "Failed to create one or more service accounts"
  fi

  create_couchdb_admin 'medic'

  if [ "$?" -ne 0 ]; then
    fatal "Failed to create interactive admin account"
  fi

  info 'New CouchDB Administrative User: medic'
  info "New Medic CouchDB Administrative User Password: $(cat /srv/storage/medic/passwd/medic)"

  info 'CouchDB first run setup successful'
}

welcome_message(){
  info 'Starting CHT API'
}

main(){
  welcome_message
  wait_for_couchdb
  if is_setup_needed; then
      info 'Running CouchDB Setup'
      postinstall "$@"
  fi

  export COUCH_URL=http://medic-api:$(cat /srv/storage/medic-api/passwd/medic-api)@$COUCHDB_SERVICE_NAME:$COUCHDB_PORT/medic
  export NODE_PATH=/app/api/node_modules
  node /app/api/server.js
}

"$@"