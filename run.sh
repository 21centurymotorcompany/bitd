echo "# Starting Mongodb......."
#sudo service mongodb start
sudo mongod --bind_ip_all --wiredTigerCacheSizeGB=${argv[0]} &
until nc -z localhost 27017
  do
    sleep 1
  done

echo "# Starting Bitdb......."
node --max-old-space-size=2048 /bitdb/index
