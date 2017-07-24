var gulp       = require('gulp');
var clean      = require('gulp-clean');
var gutil      = require('gulp-util');
var source     = require('vinyl-source-stream');
var browserify = require('browserify');
var ts         = require("gulp-typescript");
var tsProject  = ts.createProject("tsconfig.json");
var tsify      = require("tsify");

gulp.task('clean', function () {
  return gulp.src('dist', {read: false})
    .pipe(clean());
});

gulp.task("ts", ["clean"], function () {
    return browserify({
        basedir: '.',
        debug: true,
        entries: ['js/bam.ts'],
        cache: {},
        packageCache: {}
    })
    .plugin(tsify)
    .bundle()
    .pipe(source('index.js'))
    .pipe(gulp.dest("dist"));
});

gulp.task("types", ["clean", "ts"], function(){
    return gulp.src([
        './js/@types/bam/index.d.ts'
    ])
    .pipe(gulp.dest('./dist/@types/bam'));
});

gulp.task("default", ["types"]);