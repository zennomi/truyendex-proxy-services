(require("dotenv")).config()

const { HttpsProxyAgent } = require("https-proxy-agent")
const IORedis = require('ioredis')
const redis = new IORedis()
const abcache = require('abstract-cache')({
  useAwait: false,
  driver: {
    name: 'abstract-cache-redis', // must be installed via `npm i`
    options: { client: redis }
  }
})

const { getRandomInt } = require("../../utils")

const proxies = process.env.PROXY_POOL ? process.env.PROXY_POOL.split(",") : []
console.log(proxies)

const {
  getRefererHeader,
  base64UrlDecode,
  normalizeUrl,
  getCacheHeaders,
  proxyUrl,
} = require("../../utils");
const {
  proxy,
  rewriteRequestHeadersHandler,
  rewriteHeadersHandler,
  onResponseHandler,
} = require("../../proxy");
const { default: axios } = require("axios");

async function routes(fastify, options) {
  fastify.register(require("fastify-cors"), {
    origin: [
      /localhost/,
      /truyendex\.vercel\.app/,
      /nettrom\.com/,
    ],
  })
    .register(require('@fastify/redis'), { client: redis })
    ;

  const callback = (request, reply) => {
    const encodedUrl = request.params.url
    const decodedUrl = normalizeUrl(base64UrlDecode(encodedUrl));
    const header = getRefererHeader(request.url, decodedUrl);

    if (
      !("origin" in request.headers) &&
      !("x-requested-with" in request.headers)
    ) {
      return reply
        .code(400)
        .send(new Error("Missing origin or x-requested-with header."));
    }

    if (request.method === "GET" && proxyUrl(decodedUrl)) {
      const randomProxy = proxies[getRandomInt(0, proxies.length - 1)]
      const agent = new HttpsProxyAgent(randomProxy);
      const { redis } = fastify
      redis.get(encodedUrl, (error, value) => {
        if (error || !value) return axios({
          url: decodedUrl,
          httpsAgent: agent,
          headers: {
            "cache-control": getCacheHeaders("public", 30, 30)
          },
        }).then((res) => {
          reply.header("cache-control", getCacheHeaders("public", 30, 30))
          if (res.status === 200) {
            redis.set(encodedUrl, JSON.stringify(res.data), 'ex', 30, (err) => {
              reply.code(res.status).send(res.data)
            })
            return
          }
          return reply.code(res.status).send(res.data)
          // res.data.pipe(reply.raw)
        }).catch((error) => {
          return reply.code(400).send(error)
        })
        return reply.code(200).send(JSON.parse(value))
      })
      return
    }

    return proxy(request.raw, reply.raw, decodedUrl, {
      rewriteRequestHeaders: rewriteRequestHeadersHandler(header),
      rewriteHeaders: rewriteHeadersHandler(
        (headers) => !(headers["content-type"] || "").startsWith("image"),
        ([key, _]) => key.toLowerCase().startsWith("content")
      ),
      onResponse: onResponseHandler(
        "Requested content was an image.",
        reply,
        getCacheHeaders("public", 30, 30)
      ),
      request: {
        timeout: fastify.initialConfig.connectionTimeout,
      },
    });
  };

  fastify.get("/:url", callback);
  fastify.post("/:url", callback);
}

module.exports = {
  routes,
  opts: {
    prefix: "/v1/cors",
  },
};
