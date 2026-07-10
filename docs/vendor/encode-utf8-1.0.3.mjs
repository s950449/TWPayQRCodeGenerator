/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/encode-utf8@1.0.3/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var x,s;function _(){return s||(s=1,x=function(f){for(var u=[],a=f.length,e=0;e<a;e++){var r=f.charCodeAt(e);if(r>=55296&&r<=56319&&a>e+1){var h=f.charCodeAt(e+1);h>=56320&&h<=57343&&(r=(r-55296)*1024+h-56320+65536,e+=1)}if(r<128){u.push(r);continue}if(r<2048){u.push(r>>6|192),u.push(r&63|128);continue}if(r<55296||r>=57344&&r<65536){u.push(r>>12|224),u.push(r>>6&63|128),u.push(r&63|128);continue}if(r>=65536&&r<=1114111){u.push(r>>18|240),u.push(r>>12&63|128),u.push(r>>6&63|128),u.push(r&63|128);continue}u.push(239,191,189)}return new Uint8Array(u).buffer}),x}var c=_();export{c as default};
//# sourceMappingURL=/sm/402c49d2fa2ef602beaecaaf5d1de6845adaaf6fab6e97fa90f71f24047efd98.map