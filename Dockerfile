FROM ubuntu:20.04
MAINTAINER ermouth "ermouth@gmail.com"

# Update system
RUN apt-get -y update && \
    apt-get -y upgrade

# Install sys base
RUN apt-get install -y sudo curl wget

# Install node.js
RUN curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash - && \
    apt-get install -y sendmail libjpeg-progs build-essential nodejs

# Create app directory
RUN mkdir -p /usr/app
RUN mkdir -p /usr/app/src
WORKDIR /usr/app

# Install app global dependencies
RUN npm -g install node-gyp

# Copy app
COPY ./docker.js /usr/app/index.js
COPY ./package.json /usr/app/package.json

# Install packages
RUN npm install

VOLUME ["/usr/app/src"]
EXPOSE 8888 8000 8001
CMD [ "npm", "start" ]
