/*
 * ermouth.calc interpolator 1.3
 *
 * (c) ermouth
 *
 * Requires SugarJS 1.4.~
 * https://github.com/ermouth/calc/blob/master/calc-1.3.js
 */

require('sugar');
const Promise = require('bluebird');


function Plugin(method, conf, log) {
  const name = '_' + (method || 'calc');

  const isA = Object.isArray;
  const isF = Object.isFunction;

  const calc_method = (ref) => ({
    gen: function(data, bounds) {
      // Returns interpolator function of (x,y).
      // data is array of fixed points in xyz space, formed like a table of values of z(x,y) function
      // where x and y grows monotonically by columns and rows
      // [
      //   [.1,	0,	100		], //here .1 is precision, 0 and 100 x coordinates of fixed points
      //   [0,	1,	10		], //here 0 is y coordinate of values and 1,10 is values of z(0,0) and z(100,0)
      //   [10,	10,	1000	], //here 10 is y coordinate of values and 10,1000 is values of z(0,10) and z(100,10)
      //   [20,	20,	1500	]  //here 20 is y coordinate of values and 20,1500 is values of z(0,0) and z(100,0)
      // ]

      // x and|or y can be string – this case appropriate axis will make no
      // interpolation, approprite column/row/value will be fetched by index
      // calc.make ([[1,"a","b"],[0,0,500],[10,100,1000]])("b",5) will return 750

      // bounds is arbitrary function of x,y which must return false if xy pair of args lays outside
      // of required boundaries.

      // For example
      // calc.make([[1,1,10],[1,1,10],[10,10,100]], function (x,y) {return !!(x>0 && y>0)})
      // will return function of x,y, calculating rounded integer product of arguments if they both are >0 or null otherwise


      if (!isA(data) || !data.length) return null;

      var a = data.slice(0), xc = a[0].length, yc = a.length, i, r, ok;
      var ax = a[0].slice(1).join("ᴥ").split("ᴥ"),
        ay = a.map(function(e){
          return e[0]
        })
          .slice(1)
          .join("ᴥ")
          .split("ᴥ");
      for (i=1; i<yc; i++) if (a[i].length < xc) return null;

      if (yc<2) return null;

      //check if we have strings in axes
      //if we have, the axe is considered to be index, not range
      var xs=false, ys= false;
      for (i=1; i<xc && !xs; i++) xs = isNaN(a[0][i]);
      for (i=1; i<yc && !ys; i++) ys = isNaN(a[i][0]);

      ok = (isF(bounds))?(bounds):function(x,y) {
        if ((xs && ax.indexOf(x)==-1) || (ys && ay.indexOf(y)==-1)) return !1;
        var r=true;
        if (!xs && (x<a[0][1] || x>a[0][xc-1])) r=!1;
        if (r && !ys && (y<a[1][0] || y>a[yc-1][0])) r=!1;
        return r;
      };

      if (yc==2 && !ys) {a[2]=a[1].slice(0);a[2][0]+=1;yc=3}

      //generate interpolator
      var f = function InterpolateZ (x0,y0) {
        var x = xs?String(x0):(Number(x0)||0),
          y = ys?String(y0):(Number(y0)||0),
          r ,i, j, n, xi, yi,
          ai=[];
        if (!ok(x,y)) return null;

        r = [[Number(a[0][0])||0],[],[]], xi=0, yi = 0;

        if (xs && ys) {
          //get by index
          i = ax.indexOf(x); j = ay.indexOf(y); if (j==-1 || i==-1) return null;
          n = a[j+1][i+1];
          if (isNaN(n)) return null;
          return r[0][0]?r[0][0]*Math.round(n/r[0][0]):n;

        }

        if (!xs) { // x is range
          for (i=1; i<xc-1; i++) {
            if ( (x>=a[0][i] && x<= a[0][i+1]) ||
              (i==1 && x<a[0][1]) ||
              (i==xc-2 && x>a[0][xc-1])
            ) {
              r[0][1]=a[0][i];
              r[0][2]=a[0][i+1];
              xi=i;
            }
          }
        } else { //x is string index
          xi= ax.indexOf(x)+1;
          r[0][1]=1;r[0][2]=2;
        }
        if (xi>0) {
          if (!ys) { //y is range
            for (i=1; i<yc-1; i++) {
              if ((y>=a[i][0] && y<= a[i+1][0]) ||
                (i==1 && y<a[1][0]) ||
                (i==yc-2 && y>a[yc-1][0])
              ) {
                j = !!(xc-xi==1);
                ai=a[i]; r[1]=[ai[0],ai[xi],(j?ai[xi]+1:ai[xi+1])];
                ai=a[i+1]; r[2]=[ai[0],ai[xi],(j?ai[xi]+1:ai[xi+1])];
                yi=i;
              }
            }
          } else {
            i = ay.indexOf(y)+1;
            ai=a[i];
            r[1]=[1,ai[xi],ai[xi+1]];
            r[2]=[2,ai[xi],ai[xi+1]];
            yi=i;
          }
          if (yi>0) {
            x=xs?1:x;y=ys?1:y;

            var r0=r[0],r1=r[1],r2=r[2],p11=r1[1],p21=r2[1],y1=r1[0],y2=r2[0];
            var p3=r0[2]-r0[1],p4=y2-y1,p12=r1[2]-r1[1],p22=r2[2]-r2[1],x1=x-r0[1];
            n = (p11+x1*p12/p3)*(1-(y-y1)/p4)+(p21+x1*p22/p3)*(1-(y2-y)/p4);

            if (isNaN(n)) return null;
            return r0[0]?r0[0]*Math.round(n/r0[0]):n;
          }
        }
        return null;
      }
      return f;
    },
    tiles: function (x0,y0,px,py, gap) {
      // tiles area px*py with x*y bars with gaps around each bar
      // return count of bars
      let add = gap||0, x=1*x0+add, y=1*y0+add;
      function f(x) {return Math.floor(x);}
      return Math.max( f(py/y)*f(px/x), f(px/y)*f(py/x) );
    },
    min: (x, y, flist) => Object.keys(flist).map(e => flist[e](x, y)).compact().min(),
    minkey: function (x, y, flist) {
      let min = 1e50;
      let key = null;
      let i, v;
      for (i in flist) if ((v = flist[i](x,y)) != null && v < min) {
        key = i;
        min = v;
      }
      return key;
    }
  });

  function make({ ref, ctx }) {
    return calc_method.call(ctx, ref);
  }

  return Promise.resolve({ name, make });
}

module.exports = Plugin;