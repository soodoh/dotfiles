return function()
    local keymap = require('utils').keymap
    keymap('n', 'gr', "<cmd>lua require('lspsaga.rename').rename()<cr>")
    -- keymap('n', 'k', "<cmd>lua require('lspsaga.hover').render_hover_doc)<cr>")
    keymap('n', '<leader>ca', "<cmd>lua require('lspsaga.codeaction').code_action()<cr>")
    keymap('v', '<leader>ca', "<cmd>lua require('lspsaga.codeaction').range_code_action()<cr>")

    -- only show diagnostic if cursor is over the area
    keymap('n', '<leader>cc', "<cmd>lua require('lspsaga.diagnostic').show_cursor_diagnostics()<CR>")
    keymap('n', '<leader>cd', "<cmd>lua require('lspsaga.diagnostic').show_line_diagnostics()<CR>")

    keymap('n', '[e', "<cmd>lua require('lspsaga.diagnostic').lsp_jump_diagnostic_prev()<CR>")
    keymap('n', ']e', "<cmd>lua require('lspsaga.diagnostic').lsp_jump_diagnostic_next()<CR>")

    require('lspsaga').init_lsp_saga({
        code_action_prompt = {
            enable = true,
            sign = false,
            sign_priority = 20,
            virtual_text = false,
        },
    })
end
