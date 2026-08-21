# Five Card Stud Poker — static site served by nginx.
# No build step required; the game is self-contained vanilla JS/CSS/HTML.
FROM nginx:1.27-alpine

# Serve our static game files.
COPY public/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
