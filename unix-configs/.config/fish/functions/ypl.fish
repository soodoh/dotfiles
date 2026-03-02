function ypl --description 'Yarn build:library and yalc push'
    yarn run build:library && yarn dlx yalc push
end
