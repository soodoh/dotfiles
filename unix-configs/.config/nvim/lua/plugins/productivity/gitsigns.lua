return {
  -- Git status in column
  {
    "lewis6991/gitsigns.nvim",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      require("gitsigns").setup({
        signs = {
          add = { text = "│" },
          change = { text = "│" },
          delete = { text = "_" },
          topdelete = { text = "‾" },
          changedelete = { text = "~" },
          untracked = { text = "┆" },
        },
        signcolumn = true,
        current_line_blame = true, -- Toggle with `:Gitsigns toggle_current_line_blame`
        current_line_blame_opts = {
          virt_text = true,
          virt_text_pos = "eol", -- 'eol' | 'overlay' | 'right_align'
          delay = 1000,
          ignore_whitespace = false,
        },
        current_line_blame_formatter = "<author>, <author_time:%R> - <summary>",
        on_attach = function(bufnr)
          local gs = require("gitsigns")

          vim.keymap.set("n", "]g", function()
            if vim.wo.diff then
              vim.cmd.normal({ "]c", bang = true })
            else
              gs.nav_hunk("next")
            end
          end, {
            buffer = bufnr,
            desc = "Go to next hunk (Gitsigns)",
            silent = true,
          })

          vim.keymap.set("n", "[g", function()
            if vim.wo.diff then
              vim.cmd.normal({ "[c", bang = true })
            else
              gs.nav_hunk("prev")
            end
          end, {
            buffer = bufnr,
            desc = "Go to previous hunk (Gitsigns)",
            silent = true,
          })

          vim.keymap.set("n", "<leader>gs", gs.stage_hunk, {
            buffer = bufnr,
            desc = "Stage hunk (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gS", gs.stage_buffer, {
            buffer = bufnr,
            desc = "Stage buffer (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gr", gs.reset_hunk, {
            buffer = bufnr,
            desc = "Reset hunk (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gR", gs.reset_buffer, {
            buffer = bufnr,
            desc = "Reset buffer (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gu", gs.undo_stage_hunk, {
            buffer = bufnr,
            desc = "Unstage hunk (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gp", gs.preview_hunk, {
            buffer = bufnr,
            desc = "Preview hunk (Gitsigns)",
            silent = true,
          })
          vim.keymap.set("n", "<leader>gb", function()
            gs.blame_line({ full = true })
          end, {
            buffer = bufnr,
            desc = "View blame (Gitsigns)",
            silent = true,
          })
        end,
      })
    end,
  },
}
