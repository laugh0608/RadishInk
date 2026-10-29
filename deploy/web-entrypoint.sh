#!/bin/sh
set -eu
fail() { echo "RadishInk web configuration: $1" >&2; exit 1; }
base=${RADISHINK_BASE_PATH-/}
mode=${RADISHINK_DEPLOYMENT-static}
case "$base" in *[!A-Za-z0-9_/-]*) fail 'invalid base path' ;; esac
[ "${#base}" -le 200 ] && printf '%s\n' "$base" | grep -Eq '^/([A-Za-z0-9_-]+/)*$' || fail 'invalid base path'
case "$mode" in static|server) ;; *) fail 'invalid deployment mode' ;; esac
# 生成到临时目录；源产物和镜像层保持只读，不累积上次启动的配置。
work=/tmp/radishink-web
# 单独运行镜像时 /tmp 未必是 tmpfs；仅替换本入口生成的目录，保证重启可重复。
rm -rf -- "$work"
mkdir -p "$work/content" "$work/www"
cp -R /opt/radishink-web/. "$work/content/"
if [ "$base" = / ]; then
    rmdir "$work/www"
    ln -s "$work/content" "$work/www"
else
    mkdir -p "$work/www$(dirname "$base")"
    ln -s "$work/content" "$work/www${base%/}"
fi
config='{"deployment":"static"}'
if [ "$mode" = server ]; then config="{\"deployment\":\"server\",\"apiBase\":\"${base}api/v1\"}"; fi
awk -v config="$config" -v base="$base" '
  /<head>/ { print; print "<base href=\"" base "\">"; next }
  /<script id="radishink-runtime-config" type="application\/json">/ {
    print "<script id=\"radishink-runtime-config\" type=\"application/json\">" config "</script>"; inside=1; count++; next
  }
  inside { if (/<\/script>/) inside=0; next }
  { print }
  END { if (count != 1 || inside) exit 1 }
' /opt/radishink-web/index.html > "$work/content/index.html" || fail 'runtime config marker missing'
# Workbox 的 index.html revision 必须随公开运行时配置变化，否则离线入口会保留旧形态。
revision=$(sha256sum "$work/content/index.html" | cut -d ' ' -f 1)
grep -Eq 'url:"index.html",revision:"[a-f0-9]+"' /opt/radishink-web/sw.js || fail 'precache index marker missing'
sed "s/url:\"index.html\",revision:\"[a-f0-9]*\"/url:\"index.html\",revision:\"$revision\"/g" /opt/radishink-web/sw.js > "$work/content/sw.js"
api=''
if [ "$mode" = server ]; then
api="location ^~ ${base}api/ {
    if (\$request_uri ~* \"^[^?]*%(2f|5c|25|00|2e)\") { return 422; }
    proxy_pass http://server:4000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header Connection \"\";
    proxy_set_header X-Forwarded-For \"\";
    proxy_set_header X-Forwarded-Host \"\";
    proxy_set_header X-Forwarded-Proto \"\";
    proxy_set_header Forwarded \"\";
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    proxy_next_upstream off;
    proxy_read_timeout 65s;
    proxy_send_timeout 65s;
    proxy_hide_header Cache-Control;
    add_header Cache-Control no-store always;
    client_max_body_size 66m;
    error_page 413 = @body_too_large;
    error_page 502 503 504 = @upstream_unavailable;
}
location @upstream_unavailable {
    default_type application/json;
    add_header Cache-Control no-store always;
    add_header Retry-After 5 always;
    return 503 '{\"error\":{\"code\":\"upstream-unavailable\",\"message\":\"Server unavailable\",\"retryable\":true}}';
}
location @body_too_large {
    default_type application/json;
    add_header Cache-Control no-store always;
    return 413 '{\"error\":{\"code\":\"body-too-large\",\"message\":\"Request too large\",\"retryable\":false}}';
}"
fi
outside=''
if [ "$base" != / ]; then
    outside="location = ${base%/} { return 308 $base; }
location / { return 404; }"
fi
# awk 从环境读取整段配置，避免 replacement 反斜线改变 Nginx 变量。
export RI_API="$api" RI_OUTSIDE="$outside" RI_BASE="$base"
awk '{
  gsub(/@@BASE@@/, ENVIRON["RI_BASE"])
  if (/@@API_LOCATION@@/) print ENVIRON["RI_API"]
  else if (/@@OUTSIDE_LOCATION@@/) print ENVIRON["RI_OUTSIDE"]
  else print
}' /opt/radishink/nginx.conf.template > "$work/nginx.conf"
unset RI_API RI_OUTSIDE RI_BASE
nginx -t -c "$work/nginx.conf"
exec nginx -c "$work/nginx.conf" -g 'daemon off;'
