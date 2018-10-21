#!/bin/bash

set -e
if [[ "$1" == "start" ]]; then

  echo "# Starting Mongodb......."
  echo "$2"
  #sudo service mongodb start
  sudo mongod --bind_ip_all --wiredTigerCacheSizeGB=$2 &
  until nc -z localhost 27017
    do
      sleep 1
    done

  echo "# Starting Bitdb......."
  node --max-old-space-size=2048 /bitdb/index

fi

exec "$@"
