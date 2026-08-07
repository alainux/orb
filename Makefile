.PHONY: install typecheck test test-audio audio build check doctor pack clean

install:
	npm install

typecheck:
	npm run typecheck

test:
	npm test

test-audio:
	npm run test:audio-helper

audio:
	npm run build:audio

build:
	npm run build:all

check:
	npm run check

doctor:
	npm run doctor

pack:
	npm pack --ignore-scripts

clean:
	rm -rf .test-dist dist *.tgz bin/*/orb-audio bin/*/orb-audio.exe bin/*/pi-voice-audio bin/*/pi-voice-audio.exe
