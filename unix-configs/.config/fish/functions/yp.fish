function yp --description 'Yarn build and yalc push'
    yarn run build && yarn dlx yalc push
end
