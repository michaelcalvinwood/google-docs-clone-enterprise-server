#/bin/bash

rsync -a --exclude node_modules . root@appgalleria.com:/home/google-docs-clone-server
