FROM mongo:latest

ARG wiredtiger_cache=1

ENV WIREDTIGER_CACHE=$wiredtiger_cache

RUN apt-get update && \
    apt-get install -y wget unzip htop && \
    apt-get install -y sudo && \
    apt-get install -y curl && \
    apt-get install -y netcat && \
    curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs \
    libtool pkg-config build-essential autoconf automake uuid-dev

RUN wget -q https://github.com/zeromq/libzmq/releases/download/v4.2.2/zeromq-4.2.2.tar.gz
RUN tar -xzvf zeromq-4.2.2.tar.gz
WORKDIR /zeromq-4.2.2
RUN ./configure
RUN make install & ldconfig

COPY . /bitdb
RUN cd /bitdb && rm -rf node_modules && npm install

VOLUME /data/db

WORKDIR /bitdb

EXPOSE 28332

CMD ["/bin/bash", "/bitdb/run.sh", "$WIREDTIGER_CACHE"]
