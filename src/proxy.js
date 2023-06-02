(require("dotenv")).config()

const fastProxy = require("fast-proxy")

const proxies = process.env.PROXY_POOL ? process.env.PROXY_POOL.split(",") : []
console.log(proxies)

const proxy = (originReq, originRes, url, options) => {
  const randomProxy = proxies[getRandomInt(0, proxies.length)]
  console.log(randomProxy)
  fastProxy({
    base: randomProxy,
    cacheURLs: 0,
    requests: {
      http: require("follow-redirects/http"),
      https: require("follow-redirects/https"),
    },
  }).proxy(originReq, originRes, url, options)
    ;
}

const INJECTED_STATUS_HEADER = "x-content-retrieved";

const rewriteRequestHeadersHandler = (header) => {
  return (req, headers) => {
    const requestHeaders = { ...headers, referer: header };
    delete requestHeaders["x-forwarded-host"];
    return requestHeaders;
  };
};

const rewriteHeadersHandler = (successCheck, headerFilterPredicate) => {
  return (headers) => {
    if (!successCheck(headers)) {
      return {
        [INJECTED_STATUS_HEADER]: false,
      };
    } else {
      return Object.entries(headers)
        .filter(headerFilterPredicate)
        .reduce((accumulator, [key, value]) => {
          accumulator[key] = value;
          return accumulator;
        }, {});
    }
  };
};

const onResponseHandler = (errorMsg, reply, cacheHeaders) => {
  return (req, res, stream) => {
    if (INJECTED_STATUS_HEADER in res.getHeaders()) {
      reply.code(400).send(new Error(errorMsg));
    } else if (res.statusCode !== 200) {
      reply
        .code(res.statusCode)
        .send(new Error(`Requested content returned ${res.statusCode}`));
    } else {
      if (cacheHeaders) {
        reply.header("cache-control", cacheHeaders);
      }
      reply.send(stream);
    }
  };
};

module.exports = {
  proxy,
  rewriteRequestHeadersHandler,
  rewriteHeadersHandler,
  onResponseHandler,
};

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}