FROM ubuntu:16.04
MAINTAINER ftescht "dasiderk@gmail.com"

# Update system
RUN apt-get -y update && \
    apt-get -y upgrade

# Install sys base
RUN apt-get install -y sudo curl wget

# Install node.js
RUN curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash - && \
    apt-get install -y python build-essential nodejs

# Create app directory
RUN mkdir -p /usr/app
WORKDIR /usr/app

# Install app global dependencies
RUN npm -g install node-gyp

# Copy app
COPY ./package.json /usr/app/package.json

# Install packages
RUN npm install

VOLUME ["/usr/app"]
EXPOSE 8000 8001 8002 8003
CMD [ "npm", "start" ]
