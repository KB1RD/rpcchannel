#!/bin/bash

function error {
  echo
  echo -e "\e[31m\e[1m            ERROR OCCURED!\e[0m"
  echo "See the trace above for more information."
  echo -e "\e[1mFix this before commit.\e[0m"
}

function prompt {
  read -p "$1" -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]
  then
    return 0
  fi
  return 1
}

set -eE
trap "set +x; error" ERR

if ! git diff --quiet
then
  echo -e "\e[33m\e[1mYou have uncomitted Git changes. You should commit first since this has a tendency to break things.\e[0m"
  prompt "Continue anyway (y/n)? "
  echo "Ok, guess you know what you're doing. Good luck!"
fi

echo
echo Upgrading all packages past major versions.
npx yarn-upgrade-all

echo
echo Now checking that everything builds n stuff...
yarn run build
yarn run test
echo -e "\e[31m\e[1mImportant: IF YOU SEE ANY ERRORS ABOVE, FIX BEFORE COMMIT.\e[0m"
echo -e "\e[1mIt might also be smart to run 'yarn run dev' to make sure that still works, too.\e[0m"