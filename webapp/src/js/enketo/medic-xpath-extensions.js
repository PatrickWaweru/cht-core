let zscoreUtil;
let toBikramSambat;
let moment;

const isObject = (value) => {
  const type = typeof value;
  return value !== null && (type === 'object' || type === 'function');
};

const getValue = function(resultObject) {
  if (!isObject(resultObject) || !resultObject.t) {
    return resultObject;
  }

  // input fields, evaluated as `UNORDERED_NODE_ITERATOR_TYPE`, are received as arrays with one element
  if (resultObject.t === 'arr' && resultObject.v.length) {
    return resultObject.v[0];
  }

  return resultObject.v;
};

const now_and_today = () => ({ t: 'date', v: new Date() });

const toISOLocalString = function(date) {
  if (date.toString() === 'Invalid Date') {
    return date.toString();
  }

  const dt = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000))
    .toISOString()
    .replace('Z', module.exports.getTimezoneOffsetAsTime(date));

  return dt;
};

const getTimezoneOffsetAsTime = function(date) {
  const pad2 = function(x) {
    return ( x < 10 ) ? '0' + x : x;
  };

  if (date.toString() === 'Invalid Date') {
    return date.toString();
  }

  const offsetMinutesTotal = date.getTimezoneOffset();

  const direction = (offsetMinutesTotal < 0) ? '+' : '-';
  const hours = pad2(Math.abs(Math.floor(offsetMinutesTotal / 60)));
  const minutes = pad2(Math.abs(Math.floor(offsetMinutesTotal % 60)));

  return direction + hours + ':' + minutes;
};

const parseTimestampToDate = (value) => {
  const timestamp = parseInt(getValue(value));

  if (isNaN(timestamp)) {
    return { t: 'str', v: '' };
  }

  return { t:'date', v: new Date(timestamp) };
};

const convertToBikramSambat = (value) => {
  const date = getValue(value);
  if (!date) {
    return { t: 'str', v: '' };
  }

  const convertedDate = toBikramSambat(moment(date));

  return { t: 'str', v: convertedDate };
};

module.exports = {
  getTimezoneOffsetAsTime: getTimezoneOffsetAsTime,
  toISOLocalString: toISOLocalString,
  init: function(_zscoreUtil, _toBikramSambat, _moment) {
    zscoreUtil = _zscoreUtil;
    toBikramSambat = _toBikramSambat;
    moment = _moment;
  },
  func: {
    now: now_and_today,
    today: now_and_today,
    'z-score': function() {
      const args = Array.from(arguments).map(function(arg) {
        return getValue(arg);
      });
      const result = zscoreUtil.apply(null, args);
      if (!result) {
        return { t: 'str', v: '' };
      }
      return { t: 'num', v: result };
    },
    'to-bikram-sambat': convertToBikramSambat,
    'parse-timestamp-to-date': parseTimestampToDate, // Function name convention of XForm
  },
  process: {
    toExternalResult: function(r) {
      if(r.t === 'date') {
        return {
          resultType: XPathResult.STRING_TYPE,
          numberValue: r.v.getTime(),
          stringValue: module.exports.toISOLocalString(r.v),
        };
      }
    }
  }
};
